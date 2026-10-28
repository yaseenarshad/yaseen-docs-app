import { CLOUD_SAVE_PROTOCOL_VERSION as SERVER_SAVE_PROTOCOL_VERSION } from "../../convex/cloudSaveProtocol";

import { CLOUD_SAVE_PROTOCOL_VERSION as CLIENT_SAVE_PROTOCOL_VERSION } from "./cloudSaveProtocol";

describe("cloud save protocol", () => {
  it("keeps the client and server cutoff versions synchronized", () => {
    expect(CLIENT_SAVE_PROTOCOL_VERSION).toBe(SERVER_SAVE_PROTOCOL_VERSION);
  });
});
