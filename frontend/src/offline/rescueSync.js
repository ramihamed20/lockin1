import { registerOperationHandler } from "./queue.js";
import { createRescueStore, RESCUE_OPERATION } from "../rescue/storage.js";
import { rescueApi } from "../api/rescue.js";
import { TERMINAL } from "../rescue/model.js";

registerOperationHandler(RESCUE_OPERATION, {
  async execute(userId, operation, assertCurrent) {
    assertCurrent();
    const envelope = await createRescueStore(userId, rescueApi).sync(operation.payload.session_id);
    assertCurrent();
    // Keep an open session's intent: another local sample can arrive during acknowledgement.
    return envelope && !envelope.dirty && TERMINAL.has(envelope.record.status) ? "done" : "deferred";
  },
});
