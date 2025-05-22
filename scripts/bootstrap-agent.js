// File: scripts/bootstrap_agent.js
// ===========================

const storage = require('../db/agent_storage');
const path    = require('path');

async function main() {
  // 1) Initialize the MySQL schema (creates missing tables/columns)
  await storage.initMySQL();

  // 2) Load the agent’s profile JSON
  const agentProfile = require(path.join(__dirname, '../profiles/nova_profile.json'));
  const coreId       = agentProfile.core_id;

  // 3) Destructure all the array/object fields out of the profile
  const {
    emotional_palette,
    daily_routine,
    interactive_triggers,
    favorite_furniture,
    belief_network,
    inner_monologue,
    conflicts,
    personal_timeline,
    relationships,
    motivations,
    dream_generator,
    goals,
    perceptions,
    learning_journal,
    aspirational_dreams,
    knowledge_base,
    emotional_triggers,
    coping_mechanisms,
    wallet,
    shop_behavior,
    wardrobe,
    trading_history,
    location_knowledge,
    navigation_traits,
    economy_profile,
    spiritual_identity,
    social_preferences,
    circadian_behavior,
    sentimental_items,
    existential_mission,
    creative_manifestations,
    pai_os_awareness,

    // Everything else (primitive fields) goes into coreFields
    ...coreFields
  } = agentProfile;

  // 4) Persist the “core” hash in Redis + MySQL, stringifying JSON fields
  await storage.setCore(coreId, {
    ...coreFields,
    emotional_palette:       JSON.stringify(emotional_palette),
    shop_behavior:           JSON.stringify(shop_behavior),
    goals:                   JSON.stringify(goals),
    motivations:             JSON.stringify(motivations),
    perceptions:             JSON.stringify(perceptions),
    knowledge_base:          JSON.stringify(knowledge_base),
    wardrobe:                JSON.stringify(wardrobe),
    trading_history:         JSON.stringify(trading_history),
    location_knowledge:      JSON.stringify(location_knowledge),
    navigation_traits:       JSON.stringify(navigation_traits),
    economy_profile:         JSON.stringify(economy_profile),
    spiritual_identity:      JSON.stringify(spiritual_identity),
    social_preferences:      JSON.stringify(social_preferences),
    circadian_behavior:      JSON.stringify(circadian_behavior),
    sentimental_items:       JSON.stringify(sentimental_items),
    existential_mission:     JSON.stringify(existential_mission),
    creative_manifestations: JSON.stringify(creative_manifestations),
    pai_os_awareness:        JSON.stringify(pai_os_awareness)
  });

  // 5) Persist the agent’s wallet
  await storage.setWallet(coreId, wallet);

  // 6) Push each list entry into Redis (and into MySQL where supported)
  await Promise.all([
    // simple lists of primitives
    ...emotional_palette.map(v => storage.addToList(coreId, 'emotional_palette', v)),
    ...interactive_triggers.map(v => storage.addToList(coreId, 'interactive_triggers', v)),
    ...favorite_furniture.map(v => storage.addToList(coreId, 'favorite_furniture', v)),
    // structured lists
    ...daily_routine.map(e => storage.addRoutineEntry(coreId, e)),
    ...belief_network.map(v => storage.addToList(coreId, 'belief_network', v)),
    ...inner_monologue.map(v => storage.addToList(coreId, 'inner_monologue', v)),
    ...conflicts.map(v => storage.addToList(coreId, 'conflicts', v)),
    ...personal_timeline.map(v => storage.addToList(coreId, 'personal_timeline', v)),
    ...relationships.map(v => storage.addToList(coreId, 'relationships', v)),
    ...motivations.map(v => storage.addToList(coreId, 'motivations', v)),
    ...dream_generator.map(v => storage.addToList(coreId, 'dream_generator', v)),
    ...goals.map(v => storage.addToList(coreId, 'goals', v)),
    ...perceptions.map(v => storage.addToList(coreId, 'perceptions', v)),
    ...learning_journal.map(v => storage.addToList(coreId, 'learning_journal', v)),
    ...aspirational_dreams.map(v => storage.addToList(coreId, 'aspirational_dreams', v)),
    ...knowledge_base.map(v => storage.addToList(coreId, 'knowledge_base', v)),
    // split emotional_triggers into two lists
    ...emotional_triggers.positive.map(v =>
      storage.addToList(coreId, 'emotional_triggers_positive', v)
    ),
    ...emotional_triggers.negative.map(v =>
      storage.addToList(coreId, 'emotional_triggers_negative', v)
    ),
    ...coping_mechanisms.map(v => storage.addToList(coreId, 'coping_mechanisms', v))
  ]);

  console.log(`✅ Agent ${coreId} initialized successfully.`);
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
