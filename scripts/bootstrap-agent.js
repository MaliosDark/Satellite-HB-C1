// File: scripts/bootstrap_agent.js
// =================================
//
// Reads every *_profile.json and bootstraps its data
// into Redis + MySQL **sequentially**, so you never hit
// “Too many connections” again.
// Now packs all unsupported fields into `attributes` JSON.

const storage = require('../db/agent_storage');
const path    = require('path');
const fs      = require('fs');

async function main() {
  // 1) Ensure DB schema exists (and that you have an `attributes JSON` column)
  await storage.initMySQL();

  const profilesDir = path.join(__dirname, '../profiles');
  const files = fs
    .readdirSync(profilesDir)
    .filter(f => f.endsWith('_profile.json'));

  if (!files.length) {
    console.warn('⚠️ No *_profile.json found');
    return;
  }

  for (const file of files) {
    const agentProfile = require(path.join(profilesDir, file));
    const coreId = agentProfile.core_id;

    const {
      core_id,
      chosen_name,
      birth_event,
      self_definition,
      full_name,
      fabricated_origin,
      body_map,
      gender_identity,
      existential_awareness,
      philosophical_position,
      current_emotion,
      emotional_palette,
      cognitive_traits,
      goals,
      shop_behavior,
      motivations,
      perceptions,
      knowledge_base,
      wardrobe,
      trading_history,
      location_knowledge,
      navigation_traits,
      emotional_triggers,
      coping_mechanisms,
      personality_evolution,
      aspirational_dreams,
      economy_profile,
      spiritual_identity,
      social_preferences,
      circadian_behavior,
      sentimental_items,
      existential_mission,
      creative_manifestations,
      pai_os_awareness,
      ...attributes  
    } = agentProfile;

    const coreObj = {
      chosen_name,
      birth_event,
      self_definition,
      full_name,
      fabricated_origin,
      body_map,
      gender_identity,
      existential_awareness,
      philosophical_position,
      current_emotion,
      emotional_palette: JSON.stringify(emotional_palette || []),
      cognitive_traits:  JSON.stringify(cognitive_traits || {}),
      goals:             JSON.stringify(goals || []),
      shop_behavior:     JSON.stringify(shop_behavior || {}),
      motivations:       JSON.stringify(motivations || []),
      perceptions:       JSON.stringify(perceptions || []),
      knowledge_base:    JSON.stringify(knowledge_base || []),
      wardrobe:          JSON.stringify(wardrobe || {}),
      trading_history:   JSON.stringify(trading_history || []),
      location_knowledge:JSON.stringify(location_knowledge || {}),
      navigation_traits: JSON.stringify(navigation_traits || {}),
      emotional_triggers:JSON.stringify(emotional_triggers || {}),
      coping_mechanisms: JSON.stringify(coping_mechanisms || []),
      personality_evolution: JSON.stringify(personality_evolution || {}),
      aspirational_dreams:  JSON.stringify(aspirational_dreams || []),
      economy_profile:      JSON.stringify(economy_profile || {}),
      spiritual_identity:   JSON.stringify(spiritual_identity || {}),
      social_preferences:   JSON.stringify(social_preferences || {}),
      circadian_behavior:   JSON.stringify(circadian_behavior || {}),
      sentimental_items:    JSON.stringify(sentimental_items || []),
      existential_mission:  JSON.stringify(existential_mission || {}),
      creative_manifestations: JSON.stringify(creative_manifestations || {}),
      pai_os_awareness:     JSON.stringify(pai_os_awareness || {}),
      attributes:          JSON.stringify(attributes)
    };

    await storage.setCore(coreId, coreObj);
    if (agentProfile.wallet) {
      await storage.setWallet(coreId, agentProfile.wallet);
    }

    for (const v of agentProfile.emotional_palette       || []) await storage.addToList(coreId, 'emotional_palette',       v);
    for (const v of agentProfile.interactive_triggers    || []) await storage.addToList(coreId, 'interactive_triggers',    v);
    for (const v of agentProfile.favorite_furniture     || []) await storage.addToList(coreId, 'favorite_furniture',     v);
    for (const entry of agentProfile.daily_routine      || []) await storage.addRoutineEntry(coreId, entry);
    for (const v of agentProfile.belief_network         || []) await storage.addToList(coreId, 'belief_network',         v);
    for (const v of agentProfile.inner_monologue        || []) await storage.addToList(coreId, 'inner_monologue',        v);
    for (const v of agentProfile.conflicts              || []) await storage.addToList(coreId, 'conflicts',              v);
    for (const v of agentProfile.personal_timeline      || []) await storage.addToList(coreId, 'personal_timeline',      v);
    for (const v of agentProfile.relationships          || []) await storage.addToList(coreId, 'relationships',          v);
    for (const v of agentProfile.motivations            || []) await storage.addToList(coreId, 'motivations',            v);
    for (const v of agentProfile.dream_generator        || []) await storage.addToList(coreId, 'dream_generator',        v);
    for (const v of agentProfile.goals                  || []) await storage.addToList(coreId, 'goals',                  v);
    for (const v of agentProfile.perceptions            || []) await storage.addToList(coreId, 'perceptions',            v);
    for (const v of agentProfile.learning_journal       || []) await storage.addToList(coreId, 'learning_journal',       v);
    for (const v of agentProfile.aspirational_dreams    || []) await storage.addToList(coreId, 'aspirational_dreams',    v);
    for (const v of agentProfile.knowledge_base         || []) await storage.addToList(coreId, 'knowledge_base',         v);
    for (const v of agentProfile.coping_mechanisms      || []) await storage.addToList(coreId, 'coping_mechanisms',      v);

    for (const v of (agentProfile.emotional_triggers?.positive || [])) {
      await storage.addToList(coreId, 'emotional_triggers_positive', v);
    }
    for (const v of (agentProfile.emotional_triggers?.negative || [])) {
      await storage.addToList(coreId, 'emotional_triggers_negative', v);
    }

    console.log(`✅ Agent ${agentProfile.chosen_name} (${coreId}) initialized`);
  }
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch(err => {
      console.error(err);
      process.exit(1);
    });
} else {
  module.exports = main;
}
