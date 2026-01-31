import { config } from "./config.js";
import { StateManager } from "./state.js";
import { createBot } from "./bot.js";

const state = new StateManager(config.stateFilePath);
state.load();

const client = createBot(state);

function shutdown(): void {
  console.log("Shutting down...");
  state.saveImmediate();
  client.destroy();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

client.login(config.discordToken);
