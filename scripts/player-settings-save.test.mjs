import assert from "node:assert/strict";
import test from "node:test";

import { savePlayerSettings } from "../player-settings-save.mjs";

function createSupabase(results){
  const operations = [];
  const queue = [...results];
  return {
    operations,
    from(table){
      assert.equal(table, "player_settings");
      return {
        update(payload){
          const operation = { type: "update", payload };
          operations.push(operation);
          return {
            eq(column, value){
              operation.filter = [column, value];
              return this;
            },
            select(columns){
              operation.select = columns;
              return this;
            },
            async maybeSingle(){
              return queue.shift();
            },
          };
        },
        async insert(payload){
          operations.push({ type: "insert", payload });
          return queue.shift();
        },
      };
    },
  };
}

const payload = { user_id: "user-1", discord_user_id: "123" };

test("updates an existing settings row", async () => {
  const supabase = createSupabase([{ data: { discord_user_id: "123" }, error: null }]);

  assert.deepEqual(await savePlayerSettings(supabase, payload, "123"), { error: null });
  assert.deepEqual(supabase.operations, [{
    type: "update",
    payload,
    filter: ["discord_user_id", "123"],
    select: "discord_user_id",
  }]);
});

test("inserts when no settings row exists", async () => {
  const supabase = createSupabase([
    { data: null, error: null },
    { error: null },
  ]);

  assert.deepEqual(await savePlayerSettings(supabase, payload, "123"), { error: null });
  assert.deepEqual(supabase.operations.map(({ type }) => type), ["update", "insert"]);
});

test("retries the update when a concurrent insert wins", async () => {
  const conflict = { code: "23505", message: "duplicate key" };
  const supabase = createSupabase([
    { data: null, error: null },
    { error: conflict },
    { data: { discord_user_id: "123" }, error: null },
  ]);

  assert.deepEqual(await savePlayerSettings(supabase, payload, "123"), { error: null });
  assert.deepEqual(supabase.operations.map(({ type }) => type), ["update", "insert", "update"]);
});

test("preserves a conflict when the retry cannot update a row", async () => {
  const conflict = { code: "23505", message: "duplicate key" };
  const supabase = createSupabase([
    { data: null, error: null },
    { error: conflict },
    { data: null, error: null },
  ]);

  assert.deepEqual(await savePlayerSettings(supabase, payload, "123"), { error: conflict });
});
