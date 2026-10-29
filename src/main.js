// src/main.js — точка входа Qwen Hive.
import { writeFileSync } from "node:fs";
import path from "node:path";
import { API_KEY, PORT, VERSION, DATA_DIR } from "./config.js";
import { startGateway } from "./gateway/server.js";
import { pool } from "./workers/pool.js";
import { log } from "./util/log.js";

pool.init();
startGateway();
pool.warm(); // поднимает живые вкладки Chrome в фоне
log.info(`qwen-hive v${VERSION} up on :${PORT}`);
log.info(`api key stored in data/secret.key (prefix ${API_KEY.slice(0, 9)}..., len ${API_KEY.length})`);
