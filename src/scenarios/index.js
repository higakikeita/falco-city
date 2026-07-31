/* SCENARIO REGISTRY — one import line per scenario, and nothing else.
 *
 * Adding a scenario is: write src/scenarios/<id>.js against schema.js, import
 * it here, put it in the array. Same discipline as DISTRICTS (README §地区を足す)
 * — the engine derives everything else, and a scenario declares no coordinates,
 * no scores and no special cases.
 *
 * A scenario that fails validation is dropped from SCENARIOS and reported on
 * SCENARIO_ERRORS with the field path, so one bad content file cannot take the
 * game down with it, and cannot pass unnoticed either. Referential checks that
 * need the rule tables (step ids, role ids, build dependencies) run in
 * campaign.js and land in the same list.
 */
import { normalize, validateShape } from './schema.js';

import greenfield from './greenfield.js';
import inheritedAllSyscalls from './inherited-all-syscalls.js';
import standaloneK8sRules from './standalone-k8s-rules.js';
import slowOutput from './slow-output.js';
import rulesNotFollowed from './rules-not-followed.js';
import eyesButNoHands from './eyes-but-no-hands.js';
import aDifferentSource from './a-different-source.js';

const RAW = [
  greenfield,
  inheritedAllSyscalls,
  slowOutput,
  standaloneK8sRules,
  rulesNotFollowed,
  eyesButNoHands,
  aDifferentSource
];

/* the scenario the game opens on */
const DEFAULT_SCENARIO_ID = 'greenfield';

const SCENARIO_ERRORS = [];
const SCENARIOS = [];

for(const raw of RAW){
  const id = raw && raw.id ? raw.id : '(missing id)';
  const errs = validateShape(raw);
  if(errs.length){
    for(const e of errs) SCENARIO_ERRORS.push(`${id}: ${e}`);
    continue;
  }
  if(SCENARIOS.some(s => s.id === raw.id)){
    SCENARIO_ERRORS.push(`${id}: duplicate scenario id`);
    continue;
  }
  SCENARIOS.push(normalize(raw));
}
SCENARIOS.sort((a,b) => a.order - b.order || a.id.localeCompare(b.id));

if(SCENARIO_ERRORS.length)
  console.error('scenarios: %d invalid\n  %s', SCENARIO_ERRORS.length,
                SCENARIO_ERRORS.join('\n  '));

/* record a problem found later, by a layer that knows more than schema.js does */
function addScenarioError(msg){
  SCENARIO_ERRORS.push(msg);
  console.error('scenarios: %s', msg);
}

const scenarioById = id => SCENARIOS.find(s => s.id === id) || null;

export {
  SCENARIOS,
  SCENARIO_ERRORS,
  DEFAULT_SCENARIO_ID,
  scenarioById,
  addScenarioError
};
