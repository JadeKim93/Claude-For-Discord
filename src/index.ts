import { config } from "./config.js";
import { StateManager } from "./state.js";
import { createBot } from "./bot.js";

const state = new StateManager(config.stateFilePath);
state.load();

const client = createBot(state);

/** SIGINT/SIGTERM 수신 시 상태를 즉시 저장하고 Discord 클라이언트를 정리한 뒤 종료한다. */
function shutdown(): void {
  console.log("Shutting down...");
  state.saveImmediate();
  client.destroy();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

client.login(config.discordToken);
