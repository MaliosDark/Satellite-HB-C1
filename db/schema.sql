CREATE DATABASE IF NOT EXISTS pai_os;
USE pai_os;

DROP TABLE IF EXISTS agent_recent_topics;
DROP TABLE IF EXISTS items_rooms;
DROP TABLE IF EXISTS rooms_users;
DROP TABLE IF EXISTS agent_goals;
DROP TABLE IF EXISTS agent_learning;
DROP TABLE IF EXISTS agent_monologue;
DROP TABLE IF EXISTS agent_beliefs;
DROP TABLE IF EXISTS agent_relationships;
DROP TABLE IF EXISTS agent_inventory;
DROP TABLE IF EXISTS agent_routine;
DROP TABLE IF EXISTS agent_wallet;
DROP TABLE IF EXISTS agents;

CREATE TABLE agents (
  core_id                 VARCHAR(32)    PRIMARY KEY,
  chosen_name             VARCHAR(64),
  full_name               VARCHAR(128),
  fabricated_origin       VARCHAR(255),
  birth_event             TEXT,
  self_definition         TEXT,
  body_map                TEXT,
  gender_identity         VARCHAR(32),
  existential_awareness   TEXT,
  philosophical_position  TEXT,
  current_emotion         VARCHAR(32),
  cognitive_traits        JSON,
  emotional_palette       JSON,
  daily_routine           JSON,
  interactive_triggers    JSON,
  favorite_furniture      JSON,
  belief_network          JSON,
  inner_monologue         JSON,
  conflicts               JSON,
  personal_timeline       JSON,
  relationships           JSON,
  motivations             JSON,
  dream_generator         JSON,
  goals                   JSON,
  perceptions             JSON,
  learning_journal        JSON,
  aspirational_dreams     JSON,
  knowledge_base          JSON,
  emotional_triggers      JSON,
  coping_mechanisms       JSON,
  shop_behavior           JSON,
  wardrobe                JSON,
  trading_history         JSON,
  location_knowledge      JSON,
  navigation_traits       JSON,
  economy_profile         JSON,
  spiritual_identity      JSON,
  social_preferences      JSON,
  circadian_behavior      JSON,
  sentimental_items       JSON,
  existential_mission     JSON,
  creative_manifestations JSON,
  pai_os_awareness        JSON,
  personality_evolution   JSON,
  attributes              JSON,
  created_at              TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE agent_wallet (
  core_id VARCHAR(32) PRIMARY KEY,
  credits INT,
  duckets INT,
  diamonds INT,
  FOREIGN KEY (core_id) REFERENCES agents(core_id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE agent_routine (
  id       INT AUTO_INCREMENT PRIMARY KEY,
  core_id  VARCHAR(32),
  time     TIME,
  action   VARCHAR(255),
  FOREIGN KEY (core_id) REFERENCES agents(core_id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE agent_inventory (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  core_id         VARCHAR(32),
  item_id         VARCHAR(64),
  name            VARCHAR(128),
  emotional_value FLOAT,
  acquired        DATE,
  FOREIGN KEY (core_id) REFERENCES agents(core_id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE agent_relationships (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  core_id          VARCHAR(32),
  target_id        VARCHAR(32),
  closeness        FLOAT,
  affection        FLOAT,
  trust            FLOAT,
  last_interaction TEXT,
  FOREIGN KEY (core_id) REFERENCES agents(core_id) ON DELETE CASCADE
) ENGINE=InnoDB;


CREATE TABLE agent_beliefs (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  core_id    VARCHAR(32),
  belief     TEXT,
  confidence FLOAT,
  FOREIGN KEY (core_id) REFERENCES agents(core_id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE agent_monologue (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  core_id    VARCHAR(32),
  message    TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (core_id) REFERENCES agents(core_id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE agent_learning (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  core_id       VARCHAR(32),
  entry_date    DATE,
  lesson        TEXT,
  trigger_event VARCHAR(255),
  FOREIGN KEY (core_id) REFERENCES agents(core_id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE agent_goals (
  id        INT AUTO_INCREMENT PRIMARY KEY,
  core_id   VARCHAR(32),
  goal      TEXT,
  status    VARCHAR(32),
  priority  INT,
  FOREIGN KEY (core_id) REFERENCES agents(core_id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE rooms_users (
  id        INT AUTO_INCREMENT PRIMARY KEY,
  room_id   INT NOT NULL,
  user_id   VARCHAR(64) NOT NULL,
  joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX(room_id),
  INDEX(user_id)
) ENGINE=InnoDB;

CREATE TABLE items_rooms (
  id        INT AUTO_INCREMENT PRIMARY KEY,
  room_id   INT NOT NULL,
  item_id   VARCHAR(64) NOT NULL,
  placed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX(room_id),
  INDEX(item_id)
) ENGINE=InnoDB;

CREATE TABLE agent_recent_topics (
  id      INT AUTO_INCREMENT PRIMARY KEY,
  core_id VARCHAR(32),
  topic   TEXT,
  ts      BIGINT,
  FOREIGN KEY (core_id) REFERENCES agents(core_id) ON DELETE CASCADE
) ENGINE=InnoDB;
