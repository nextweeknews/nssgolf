INSERT INTO public.tournament_admin_events (
  event_key,
  display_name,
  route_path,
  sheet_id,
  source_ranges,
  editable_ranges,
  formula_ranges,
  editor_tables,
  sort_order
)
VALUES
  (
    'worldopen',
    'World Open',
    '/worldopen',
    '1WcRVGmEpQkRDTwe8aDfQgxuDoapvLxAdSjnqg4PHgXM',
    ARRAY[
      '''2026 Results''!C2:F33',
      '''2026 Results''!J2:M17',
      '''2026 Results''!Q2:T17',
      '''2026 Results''!X2:AA9',
      '''2026 Results''!AE2:AH5',
      '''2026 Results''!AL2:AO3',
      '''2026 Results''!AS2:AV2'
    ],
    ARRAY[
      '''2026 Results''!D2:D33', '''2026 Results''!F2:F33',
      '''2026 Results''!K2:K17', '''2026 Results''!M2:M17',
      '''2026 Results''!R2:R17', '''2026 Results''!T2:T17',
      '''2026 Results''!Y2:Y9', '''2026 Results''!AA2:AA9',
      '''2026 Results''!AF2:AF5', '''2026 Results''!AH2:AH5',
      '''2026 Results''!AM2:AM3', '''2026 Results''!AO2:AO3',
      '''2026 Results''!AT2', '''2026 Results''!AV2'
    ],
    ARRAY[
      '''2026 Results''!A2:A65',
      '''2026 Results''!C2:C33', '''2026 Results''!E2:E33',
      '''2026 Results''!J2:J17', '''2026 Results''!L2:L17',
      '''2026 Results''!Q2:Q17', '''2026 Results''!S2:S17',
      '''2026 Results''!X2:X9', '''2026 Results''!Z2:Z9',
      '''2026 Results''!AE2:AE5', '''2026 Results''!AG2:AG5',
      '''2026 Results''!AL2:AL3', '''2026 Results''!AN2:AN3',
      '''2026 Results''!AS2', '''2026 Results''!AU2', '''2026 Results''!AX2'
    ],
    $json$
    [
      {
        "key":"round-1", "label":"First Round", "group_key":"round-1", "group_label":"First Round",
        "source_range":"'2026 Results'!C2:F33", "data_start_row":2, "data_end_row":33,
        "hide_context":true, "hide_seed":true, "matchup_layout":true,
        "players":[
          {"name_column":"C", "round_score_columns":[], "result_column":"D"},
          {"name_column":"E", "round_score_columns":[], "result_column":"F"}
        ]
      },
      {
        "key":"round-2", "label":"Second Round", "group_key":"round-2", "group_label":"Second Round",
        "source_range":"'2026 Results'!J2:M17", "data_start_row":2, "data_end_row":17,
        "hide_context":true, "hide_seed":true, "matchup_layout":true,
        "players":[
          {"name_column":"J", "round_score_columns":[], "result_column":"K"},
          {"name_column":"L", "round_score_columns":[], "result_column":"M"}
        ]
      },
      {
        "key":"round-3", "label":"Round of 32", "group_key":"round-3", "group_label":"Round of 32",
        "source_range":"'2026 Results'!Q2:T17", "data_start_row":2, "data_end_row":17,
        "hide_context":true, "hide_seed":true, "matchup_layout":true,
        "players":[
          {"name_column":"Q", "round_score_columns":[], "result_column":"R"},
          {"name_column":"S", "round_score_columns":[], "result_column":"T"}
        ]
      },
      {
        "key":"round-4", "label":"Round of 16", "group_key":"round-4", "group_label":"Round of 16",
        "source_range":"'2026 Results'!X2:AA9", "data_start_row":2, "data_end_row":9,
        "hide_context":true, "hide_seed":true, "matchup_layout":true,
        "players":[
          {"name_column":"X", "round_score_columns":[], "result_column":"Y"},
          {"name_column":"Z", "round_score_columns":[], "result_column":"AA"}
        ]
      },
      {
        "key":"round-5", "label":"Quarterfinals", "group_key":"round-5", "group_label":"Quarterfinals",
        "source_range":"'2026 Results'!AE2:AH5", "data_start_row":2, "data_end_row":5,
        "hide_context":true, "hide_seed":true, "matchup_layout":true,
        "players":[
          {"name_column":"AE", "round_score_columns":[], "result_column":"AF"},
          {"name_column":"AG", "round_score_columns":[], "result_column":"AH"}
        ]
      },
      {
        "key":"round-6", "label":"Semifinals", "group_key":"round-6", "group_label":"Semifinals",
        "source_range":"'2026 Results'!AL2:AO3", "data_start_row":2, "data_end_row":3,
        "hide_context":true, "hide_seed":true, "matchup_layout":true,
        "players":[
          {"name_column":"AL", "round_score_columns":[], "result_column":"AM"},
          {"name_column":"AN", "round_score_columns":[], "result_column":"AO"}
        ]
      },
      {
        "key":"round-7", "label":"Final", "group_key":"round-7", "group_label":"Final",
        "source_range":"'2026 Results'!AS2:AV2", "data_start_row":2, "data_end_row":2,
        "hide_context":true, "hide_seed":true, "matchup_layout":true,
        "players":[
          {"name_column":"AS", "round_score_columns":[], "result_column":"AT"},
          {"name_column":"AU", "round_score_columns":[], "result_column":"AV"}
        ]
      }
    ]
    $json$::jsonb,
    20
  ),
  (
    'lightningcup',
    'Lightning Cup',
    '/lightningcup',
    '1nqZpVdf8bRlNAS-a16HeW5Lp9za5bKT18GofnXI7FXQ',
    ARRAY['''Bracket''!A2:T66'],
    ARRAY[
      '''Bracket''!F4:F66', '''Bracket''!I4:I66',
      '''Bracket''!O4:Q66', '''Bracket''!R4:T66'
    ],
    ARRAY[
      '''Bracket''!D4:E66', '''Bracket''!G4:H66',
      '''Bracket''!J4:L66'
    ],
    $json$
    [
      {
        "key":"wii-plaza", "label":"Wii Plaza", "group_key":"wii-plaza", "group_label":"Wii Plaza",
        "source_range":"'Bracket'!A2:T66", "data_start_row":4, "data_end_row":66,
        "included_rows":[4,5,6,7,8,9,10,11,36,37,38,39,52,53,60],
        "context_columns":["A","B"], "hide_seed":false, "matchup_layout":true,
        "round_labels":["Set 1","Set 2","Set 3"],
        "players":[
          {"seed_column":"D", "name_column":"E", "round_score_columns":["O","P","Q"], "result_column":"F"},
          {"seed_column":"G", "name_column":"H", "round_score_columns":["R","S","T"], "result_column":"I"}
        ]
      },
      {
        "key":"wuhu-island", "label":"Wuhu Island", "group_key":"wuhu-island", "group_label":"Wuhu Island",
        "source_range":"'Bracket'!A2:T66", "data_start_row":4, "data_end_row":66,
        "included_rows":[12,13,14,15,16,17,18,19,40,41,42,43,54,55,61],
        "context_columns":["A","B"], "hide_seed":false, "matchup_layout":true,
        "round_labels":["Set 1","Set 2","Set 3"],
        "players":[
          {"seed_column":"D", "name_column":"E", "round_score_columns":["O","P","Q"], "result_column":"F"},
          {"seed_column":"G", "name_column":"H", "round_score_columns":["R","S","T"], "result_column":"I"}
        ]
      },
      {
        "key":"wedge-island", "label":"Wedge Island", "group_key":"wedge-island", "group_label":"Wedge Island",
        "source_range":"'Bracket'!A2:T66", "data_start_row":4, "data_end_row":66,
        "included_rows":[28,29,30,31,32,33,34,35,48,49,50,51,58,59,63],
        "context_columns":["A","B"], "hide_seed":false, "matchup_layout":true,
        "round_labels":["Set 1","Set 2","Set 3"],
        "players":[
          {"seed_column":"D", "name_column":"E", "round_score_columns":["O","P","Q"], "result_column":"F"},
          {"seed_column":"G", "name_column":"H", "round_score_columns":["R","S","T"], "result_column":"I"}
        ]
      },
      {
        "key":"spocco-square", "label":"Spocco Square", "group_key":"spocco-square", "group_label":"Spocco Square",
        "source_range":"'Bracket'!A2:T66", "data_start_row":4, "data_end_row":66,
        "included_rows":[20,21,22,23,24,25,26,27,44,45,46,47,56,57,62],
        "context_columns":["A","B"], "hide_seed":false, "matchup_layout":true,
        "round_labels":["Set 1","Set 2","Set 3"],
        "players":[
          {"seed_column":"D", "name_column":"E", "round_score_columns":["O","P","Q"], "result_column":"F"},
          {"seed_column":"G", "name_column":"H", "round_score_columns":["R","S","T"], "result_column":"I"}
        ]
      },
      {
        "key":"finals", "label":"Finals", "group_key":"finals", "group_label":"Finals",
        "source_range":"'Bracket'!A2:T66", "data_start_row":64, "data_end_row":66,
        "context_columns":["A","B"], "hide_seed":false, "matchup_layout":true,
        "round_labels":["Set 1","Set 2","Set 3"],
        "players":[
          {"seed_column":"D", "name_column":"E", "round_score_columns":["O","P","Q"], "result_column":"F"},
          {"seed_column":"G", "name_column":"H", "round_score_columns":["R","S","T"], "result_column":"I"}
        ]
      }
    ]
    $json$::jsonb,
    40
  ),
  (
    'noptational',
    'The Noptational',
    '/noptational',
    '1T7kmgUtimrOW3LaTw2hYLMFvO600SjmUDLTecL6gY00',
    ARRAY['''Round Scores (2026)''!A1:J72'],
    ARRAY['''Round Scores (2026)''!B2:J72'],
    ARRAY['''Round Scores (2026)''!A1:A72', '''Round Scores (2026)''!B1:J1'],
    $json$
    [
      {
        "key":"classic", "label":"Classic", "group_key":"classic", "group_label":"Classic",
        "source_range":"'Round Scores (2026)'!A1:J72", "data_start_row":2, "data_end_row":72,
        "hide_context":true, "hide_seed":true, "round_labels":["Round 1","Round 2"],
        "players":[{"name_column":"A", "round_score_columns":["B","C"]}]
      },
      {
        "key":"resort", "label":"Resort", "group_key":"resort", "group_label":"Resort",
        "source_range":"'Round Scores (2026)'!A1:J72", "data_start_row":2, "data_end_row":72,
        "hide_context":true, "hide_seed":true, "round_labels":["Round 1","Round 2"],
        "players":[{"name_column":"A", "round_score_columns":["D","E"]}]
      },
      {
        "key":"specials", "label":"Specials", "group_key":"specials", "group_label":"Specials",
        "source_range":"'Round Scores (2026)'!A1:J72", "data_start_row":2, "data_end_row":72,
        "hide_context":true, "hide_seed":true, "round_labels":["Round 1","Round 2","Round 3"],
        "players":[{"name_column":"A", "round_score_columns":["F","G","H"]}]
      },
      {
        "key":"eighteen", "label":"18 Holes", "group_key":"eighteen", "group_label":"18 Holes",
        "source_range":"'Round Scores (2026)'!A1:J72", "data_start_row":2, "data_end_row":72,
        "hide_context":true, "hide_seed":true, "round_labels":["Round 1","Round 2"],
        "players":[{"name_column":"A", "round_score_columns":["I","J"]}]
      }
    ]
    $json$::jsonb,
    50
  );

UPDATE public.tournament_admin_events
SET sort_order = CASE event_key
  WHEN 'proleague' THEN 10
  WHEN 'worldopen' THEN 20
  WHEN 'superleague' THEN 30
  WHEN 'lightningcup' THEN 40
  WHEN 'noptational' THEN 50
  WHEN 'championship' THEN 60
  WHEN 'masters' THEN 70
  ELSE sort_order
END
WHERE event_key IN ('proleague', 'worldopen', 'superleague', 'lightningcup', 'noptational', 'championship', 'masters');
