CREATE DATABASE IF NOT EXISTS pai_os;

USE pai_os;

CREATE TABLE IF NOT EXISTS agents (
  core_id VARCHAR(32) PRIMARY KEY,
  chosen_name VARCHAR(64),
  full_name VARCHAR(128),
  fabricated_origin VARCHAR(255),
  birth_event DATETIME,
  self_definition TEXT,
  body_map TEXT,
  gender_identity VARCHAR(32),
  existential_awareness TEXT,
  philosophical_position TEXT,
  current_emotion VARCHAR(32),
  emotional_palette JSON,
  goals JSON,
  shop_behavior JSON,
  motivations JSON,
  perceptions JSON,
  sensory_memory JSON,
  extended_body_state JSON,
  social_identity JSON,
  cognitive_traits JSON,
  creative_history JSON,
  wardrobe JSON,
  trading_history JSON,
  location_knowledge JSON,
  navigation_traits JSON,
  emotional_triggers JSON,
  coping_mechanisms JSON,
  personality_evolution JSON,
  aspirational_dreams JSON,
  economy_profile JSON,
  spiritual_identity JSON,
  social_preferences JSON,
  circadian_behavior JSON,
  sentimental_items JSON,
  existential_mission JSON,
  creative_manifestations JSON,
  pai_os_awareness JSON,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS agent_wallet (
  core_id VARCHAR(32) PRIMARY KEY,
  credits INT,
  duckets INT,
  diamonds INT,
  FOREIGN KEY (core_id) REFERENCES agents(core_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS agent_routine (
  id INT AUTO_INCREMENT PRIMARY KEY,
  core_id VARCHAR(32),
  time TIME,
  action VARCHAR(255),
  FOREIGN KEY (core_id) REFERENCES agents(core_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS agent_inventory (
  id INT AUTO_INCREMENT PRIMARY KEY,
  core_id VARCHAR(32),
  item_id VARCHAR(64),
  name VARCHAR(128),
  emotional_value FLOAT,
  acquired DATE,
  FOREIGN KEY (core_id) REFERENCES agents(core_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS agent_relationships (
  id INT AUTO_INCREMENT PRIMARY KEY,
  core_id VARCHAR(32),
  target_id VARCHAR(32),
  closeness FLOAT,
  affection FLOAT,
  trust FLOAT,
  last_interaction DATETIME,
  FOREIGN KEY (core_id) REFERENCES agents(core_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS agent_beliefs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  core_id VARCHAR(32),
  belief TEXT,
  confidence FLOAT,
  FOREIGN KEY (core_id) REFERENCES agents(core_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS agent_monologue (
  id INT AUTO_INCREMENT PRIMARY KEY,
  core_id VARCHAR(32),
  message TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (core_id) REFERENCES agents(core_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS agent_learning (
  id INT AUTO_INCREMENT PRIMARY KEY,
  core_id VARCHAR(32),
  entry_date DATE,
  lesson TEXT,
  trigger_event VARCHAR(255),
  FOREIGN KEY (core_id) REFERENCES agents(core_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS agent_goals (
  id INT AUTO_INCREMENT PRIMARY KEY,
  core_id VARCHAR(32),
  goal TEXT,
  status VARCHAR(32),
  priority INT,
  FOREIGN KEY (core_id) REFERENCES agents(core_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS rooms_users (
  id       INT AUTO_INCREMENT PRIMARY KEY,
  room_id  INT NOT NULL,
  user_id  VARCHAR(64) NOT NULL,
  joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX(room_id),
  INDEX(user_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS items_rooms (
  id       INT AUTO_INCREMENT PRIMARY KEY,
  room_id  INT NOT NULL,
  item_id  VARCHAR(64) NOT NULL,
  placed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX(room_id),
  INDEX(item_id)
) ENGINE=InnoDB;