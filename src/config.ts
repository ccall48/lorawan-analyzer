import { readFileSync, existsSync } from 'fs';
import toml from 'toml';
import type { Config } from './types.js';

const DEFAULT_CONFIG: Config = {
  mqtt: {
    server: 'tcp://172.17.0.1:1883',
    username: '',
    password: '',
    topic: '#',
    format: 'protobuf',
  },
  mqttintegration: {
    server: 'tcp://172.17.0.1:1883',
    username: '',
    password: '',
    topic: '#',
    format: 'json',
  },
  postgres: {
    url: 'postgres://lorawan:lorawan@postgres:5432/lorawan',
  },
  api: {
    bind: '0.0.0.0:3000',
  },
  operators: [],
  hide_rules: [],
};

export function loadConfig(configPath: string): Config {
  if (!existsSync(configPath)) {
    console.warn(`Config file not found at ${configPath}, using defaults`);
    return DEFAULT_CONFIG;
  }

  const content = readFileSync(configPath, 'utf-8');
  const parsed = toml.parse(content) as Partial<Config>;

  return {
    mqtt: { ...DEFAULT_CONFIG.mqtt, ...parsed.mqtt },
    mqttintegration: { ...DEFAULT_CONFIG.mqttintegration, ...parsed.mqttintegration },
    postgres: { ...DEFAULT_CONFIG.postgres, ...parsed.postgres },
    api: { ...DEFAULT_CONFIG.api, ...parsed.api },
    operators: parsed.operators ?? [],
    hide_rules: parsed.hide_rules ?? [],
  };
}
