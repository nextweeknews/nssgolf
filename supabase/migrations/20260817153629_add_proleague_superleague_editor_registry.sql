INSERT INTO public.tournament_admin_events (
  event_key,
  display_name,
  route_path,
  sheet_id,
  source_ranges,
  editable_ranges,
  formula_ranges,
  editor_tables,
  sort_order,
  archived,
  archived_at
)
VALUES
  (
    'proleague',
    'Shotgun Pro League',
    '/proleague',
    '1qIM0HKhx9Y-3eCJCFzBqrbATwiPrK3C1ynATwZzRC1o',
    ARRAY[
      '''Season 7, Stage 1''!B3:S101',
      '''Season 7, Stage 2''!B3:S101',
      '''Season 7, Stage 3''!B3:S101',
      '''Season 7, Championship''!B3:H23',
      '''Season 7, Championship''!O3:P9',
      '''Season 7, Championship''!R4:S8'
    ],
    ARRAY[
      '''Season 7, Stage 1''!L5:S8', '''Season 7, Stage 1''!L10:S13',
      '''Season 7, Stage 1''!L15:S18', '''Season 7, Stage 1''!L20:S23',
      '''Season 7, Stage 1''!L25:S28', '''Season 7, Stage 1''!L30:S33',
      '''Season 7, Stage 1''!L35:S38', '''Season 7, Stage 1''!L40:S43',
      '''Season 7, Stage 1''!L45:S48', '''Season 7, Stage 1''!L50:S53',
      '''Season 7, Stage 1''!L55:S58', '''Season 7, Stage 1''!L60:S63',
      '''Season 7, Stage 1''!L66:S101',
      '''Season 7, Stage 2''!L5:S8', '''Season 7, Stage 2''!L10:S13',
      '''Season 7, Stage 2''!L15:S18', '''Season 7, Stage 2''!L20:S23',
      '''Season 7, Stage 2''!L25:S28', '''Season 7, Stage 2''!L30:S33',
      '''Season 7, Stage 2''!L35:S38', '''Season 7, Stage 2''!L40:S43',
      '''Season 7, Stage 2''!L45:S48', '''Season 7, Stage 2''!L50:S53',
      '''Season 7, Stage 2''!L55:S58', '''Season 7, Stage 2''!L60:S63',
      '''Season 7, Stage 2''!L66:S101',
      '''Season 7, Stage 3''!L5:S8', '''Season 7, Stage 3''!L10:S13',
      '''Season 7, Stage 3''!L15:S18', '''Season 7, Stage 3''!L20:S23',
      '''Season 7, Stage 3''!L25:S28', '''Season 7, Stage 3''!L30:S33',
      '''Season 7, Stage 3''!L35:S38', '''Season 7, Stage 3''!L40:S43',
      '''Season 7, Stage 3''!L45:S48', '''Season 7, Stage 3''!L50:S53',
      '''Season 7, Stage 3''!L55:S58', '''Season 7, Stage 3''!L60:S63',
      '''Season 7, Stage 3''!L66:S101',
      '''Season 7, Championship''!E5:H8', '''Season 7, Championship''!E10:H13',
      '''Season 7, Championship''!E15:H18', '''Season 7, Championship''!E20:H23',
      '''Season 7, Championship''!P3', '''Season 7, Championship''!P5',
      '''Season 7, Championship''!P7', '''Season 7, Championship''!P9',
      '''Season 7, Championship''!S4', '''Season 7, Championship''!S8'
    ],
    ARRAY[
      '''Season 7, Stage 1''!B4:K101',
      '''Season 7, Stage 2''!B4:K101',
      '''Season 7, Stage 3''!B4:K101',
      '''Season 7, Championship''!B4:D23',
      '''Season 7, Championship''!O3:O9'
    ],
    $json$
    [
      {
        "key": "stage-1-scores", "label": "Player scores",
        "group_key": "stage-1", "group_label": "Stage 1",
        "source_range": "'Season 7, Stage 1'!B3:S101",
        "data_start_row": 5, "data_end_row": 101,
        "excluded_rows": [9,14,19,24,29,34,39,44,49,54,59,64,65],
        "context_columns": ["B"],
        "players": [{"name_column":"C","round_score_columns":["L","M","N","O","P","Q","R","S"]}]
      },
      {
        "key": "stage-2-scores", "label": "Player scores",
        "group_key": "stage-2", "group_label": "Stage 2",
        "source_range": "'Season 7, Stage 2'!B3:S101",
        "data_start_row": 5, "data_end_row": 101,
        "excluded_rows": [9,14,19,24,29,34,39,44,49,54,59,64,65],
        "context_columns": ["B"],
        "players": [{"name_column":"C","round_score_columns":["L","M","N","O","P","Q","R","S"]}]
      },
      {
        "key": "stage-3-scores", "label": "Player scores",
        "group_key": "stage-3", "group_label": "Stage 3",
        "source_range": "'Season 7, Stage 3'!B3:S101",
        "data_start_row": 5, "data_end_row": 101,
        "excluded_rows": [9,14,19,24,29,34,39,44,49,54,59,64,65],
        "context_columns": ["B"],
        "players": [{"name_column":"C","round_score_columns":["L","M","N","O","P","Q","R","S"]}]
      },
      {
        "key": "championship-player-scores", "label": "Player scores",
        "group_key": "championship", "group_label": "Championship",
        "source_range": "'Season 7, Championship'!B3:H23",
        "data_start_row": 5, "data_end_row": 23,
        "excluded_rows": [9,14,19],
        "context_columns": [],
        "players": [{"name_column":"B","round_score_columns":["E","F","G","H"]}]
      },
      {
        "key": "championship-semifinals", "label": "Semifinal team scores",
        "group_key": "championship", "group_label": "Championship",
        "source_range": "'Season 7, Championship'!O3:P9",
        "data_start_row": 3, "data_end_row": 9,
        "excluded_rows": [4,6,8],
        "context_columns": [],
        "players": [{"name_column":"O","round_score_columns":[],"result_column":"P"}]
      },
      {
        "key": "championship-finals", "label": "Final team scores",
        "group_key": "championship", "group_label": "Championship",
        "source_range": "'Season 7, Championship'!R4:S8",
        "data_start_row": 4, "data_end_row": 8,
        "excluded_rows": [5,6,7],
        "context_columns": [],
        "players": [{"name_column":"R","round_score_columns":[],"result_column":"S"}]
      }
    ]
    $json$::jsonb,
    30,
    true,
    statement_timestamp()
  ),
  (
    'superleague',
    'Super League',
    '/superleague',
    '1BbT8t6erCVdx-Bdshv_hax9r9JSRzU1WygjWxW3vPkY',
    ARRAY[
      '''Season 6''!I2:AB85',
      '''Season 6''!I87:AB92',
      '''S6 Winners Bracket''!A3:H80',
      '''S6 Losers Bracket''!A4:H62'
    ],
    ARRAY[
      '''Season 6''!M2:O85', '''Season 6''!V2:X85',
      '''Season 6''!M87:O92', '''Season 6''!V87:X92',
      '''S6 Winners Bracket''!E5:E68', '''S6 Winners Bracket''!H5:H68',
      '''S6 Losers Bracket''!E4:E62', '''S6 Losers Bracket''!H4:H62'
    ],
    ARRAY[
      '''Season 6''!P2:S85', '''Season 6''!Y2:AB85',
      '''Season 6''!P87:S92', '''Season 6''!Y87:AB92',
      '''S6 Winners Bracket''!A5:D68', '''S6 Winners Bracket''!F5:G68',
      '''S6 Losers Bracket''!A4:D62', '''S6 Losers Bracket''!F4:G62'
    ],
    $json$
    [
      {
        "key": "season-schedule", "label": "Regular season",
        "group_key": "season", "group_label": "Season",
        "source_range": "'Season 6'!I2:AB85",
        "data_start_row": 2, "data_end_row": 85,
        "context_columns": ["I","J"],
        "players": [
          {"name_column":"L","round_score_columns":["M","N","O"]},
          {"name_column":"U","round_score_columns":["V","W","X"]}
        ]
      },
      {
        "key": "season-playoffs", "label": "Playoffs",
        "group_key": "season", "group_label": "Season",
        "source_range": "'Season 6'!I87:AB92",
        "data_start_row": 87, "data_end_row": 92,
        "context_columns": ["I","J"],
        "players": [
          {"seed_column":"K","name_column":"L","round_score_columns":["M","N","O"]},
          {"seed_column":"T","name_column":"U","round_score_columns":["V","W","X"]}
        ]
      },
      {
        "key": "qualifier-winners", "label": "Winners bracket",
        "group_key": "qualifiers", "group_label": "Qualifiers",
        "source_range": "'S6 Winners Bracket'!A3:H80",
        "data_start_row": 5, "data_end_row": 68,
        "context_columns": ["A","B"],
        "players": [
          {"seed_column":"C","name_column":"D","round_score_columns":[],"result_column":"E"},
          {"seed_column":"F","name_column":"G","round_score_columns":[],"result_column":"H"}
        ]
      },
      {
        "key": "qualifier-losers", "label": "Losers bracket",
        "group_key": "qualifiers", "group_label": "Qualifiers",
        "source_range": "'S6 Losers Bracket'!A4:H62",
        "data_start_row": 4, "data_end_row": 62,
        "context_columns": ["A","B"],
        "players": [
          {"seed_column":"C","name_column":"D","round_score_columns":[],"result_column":"E"},
          {"seed_column":"F","name_column":"G","round_score_columns":[],"result_column":"H"}
        ]
      }
    ]
    $json$::jsonb,
    40,
    true,
    statement_timestamp()
  );
