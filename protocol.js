module.exports = Object.freeze({
  VERSION: 1,
  EVENTS: Object.freeze({
    HELLO: "hello",
    CHECK_CONN: "checkConn",
    GAME_STATE: "game",
    FRAME_INPUT: "frame",
    FRAME_NOTIFY: "notifyFrame",
    REQUEST_FRAME: "requestFrame",
    VERIFY: "verify",
    DEAD: "dead"
  })
});
