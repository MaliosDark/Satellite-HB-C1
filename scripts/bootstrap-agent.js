// File: scripts/init_agent.js
// ===========================

const storage = require('../db/agent_storage');
const path    = require('path');

async function main() {
  await storage.initMySQL();

  const agentProfile = require(path.join(__dirname,'../profiles/nova_profile.json'));
  const coreId       = agentProfile.core_id;

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
    aspirational_dreams: _dup1, 
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

    ...coreFields
  } = agentProfile;


  await storage.setCore(coreId, coreFields);
  await storage.setWallet(coreId, wallet);

  await Promise.all([
    ...emotional_palette.map(v => storage.addToList(coreId, 'emotional_palette', v)),
    ...daily_routine.map(e => storage.addRoutineEntry(coreId, e)),
    ...interactive_triggers.map(v => storage.addToList(coreId, 'interactive_triggers', v)),
    ...favorite_furniture.map(v => storage.addToList(coreId, 'favorite_furniture', v)),
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
