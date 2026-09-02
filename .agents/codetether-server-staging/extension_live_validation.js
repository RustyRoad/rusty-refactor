"use strict";

const assert = require("assert");
const { CodetetherRealtimeClient } = require(
    "../../out/codetetherRealtimeClient"
);


/**
 * Runs the extension's compiled client against the forwarded GPU server.
 */
async function validate() {
    const token = process.env.WS_VALIDATION_TOKEN;
    const client = new CodetetherRealtimeClient(
        "127.0.0.1",
        Number(process.env.WS_VALIDATION_PORT),
        token
    );
    const progress = [];
    let steer;
    let steering;
    const completion = client.complete(
        "Run `printf extension-live-validation` with a shell tool. "
            + "Then wait for my steering message before answering.",
        {
            sink: update => {
                progress.push(update);
                if (!steering && update.toolEvent?.kind === "call") {
                    steering = steer(
                        "Answer with the marker EXTENSION_STEERING_APPLIED."
                    );
                }
            },
            onSteeringReady: sender => {
                steer = sender;
            }
        }
    );
    const result = await completion;
    assert.equal(await steering, true);
    assert.ok(progress.some(update => update.textDelta));
    assert.ok(result.toolEvents.some(event => event.kind === "call"));
    assert.match(result.text, /EXTENSION_STEERING_APPLIED/);
    console.log(JSON.stringify({
        client: "compiled_extension_transport",
        streamed_text: true,
        tool_events: result.toolEvents.length,
        steering: "accepted_and_applied"
    }));
}


validate().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
