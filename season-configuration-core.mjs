export const DEFAULT_SEASON_CONFIGURATION = Object.freeze({
  rankedLeagueSeason:13,
  shotgunProLeagueSeason:7,
  shotgunProLeagueStage:3,
  superLeagueSeason:6,
});

function boundedInteger(value, fallback, minimum = 1, maximum = 99){
  const number = Number(value);
  return Number.isInteger(number) && number >= minimum && number <= maximum ? number : fallback;
}

export function normalizeSeasonConfiguration(value = {}){
  return {
    rankedLeagueSeason:boundedInteger(value.rankedLeagueSeason ?? value.ranked_league_season, DEFAULT_SEASON_CONFIGURATION.rankedLeagueSeason, 7),
    shotgunProLeagueSeason:boundedInteger(value.shotgunProLeagueSeason ?? value.shotgun_pro_league_season, DEFAULT_SEASON_CONFIGURATION.shotgunProLeagueSeason),
    shotgunProLeagueStage:boundedInteger(value.shotgunProLeagueStage ?? value.shotgun_pro_league_stage, DEFAULT_SEASON_CONFIGURATION.shotgunProLeagueStage, 1, 3),
    superLeagueSeason:boundedInteger(value.superLeagueSeason ?? value.super_league_season, DEFAULT_SEASON_CONFIGURATION.superLeagueSeason),
  };
}

export function seasonConfigurationRpcParams(value, expectedValue){
  if(!expectedValue || typeof expectedValue !== "object"){
    throw new TypeError("Expected season configuration is required.");
  }
  const configuration = normalizeSeasonConfiguration(value);
  const expectedConfiguration = normalizeSeasonConfiguration(expectedValue);
  return {
    p_ranked_league_season:configuration.rankedLeagueSeason,
    p_shotgun_pro_league_season:configuration.shotgunProLeagueSeason,
    p_shotgun_pro_league_stage:configuration.shotgunProLeagueStage,
    p_super_league_season:configuration.superLeagueSeason,
    p_expected_configuration:expectedConfiguration,
  };
}
