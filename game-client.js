/* global $ */
var client = require("./client");
var core = require("./game-core");
var io = require('socket.io-client');
var protocol = require("./protocol");

var GRID_SIZE = core.GRID_SIZE;
var CELL_WIDTH = core.CELL_WIDTH;

client.allowAnimation = true;
client.renderer = require("./client-modes/user-mode");
  
/**
 * Provides requestAnimationFrame in a cross browser way. (edited so that this is also compatible with node.)
 * @author paulirish / http://paulirish.com/
 */
// window.requestAnimationFrame = function( /* function FrameRequestCallback */ callback, /* DOMElement Element */ element ) {
//       window.setTimeout( callback, 1000 / 60 );
//     };
var hasWindow;
try {
  window.document;
  hasWindow = true;
} catch (e) {
  hasWindow = false;
}

var requestAnimationFrame;
if ( !requestAnimationFrame ) {
  requestAnimationFrame = ( function() {
    if (hasWindow) {
      return window.requestAnimationFrame ||
      window.webkitRequestAnimationFrame ||
      window.mozRequestAnimationFrame ||
      window.oRequestAnimationFrame ||
      window.msRequestAnimationFrame ||
      function( /* function FrameRequestCallback */ callback, /* DOMElement Element */ element ) {
        setTimeout( callback, 1000 / 60 );
      };
    } else {
      return function( /* function FrameRequestCallback */ callback, /* DOMElement Element */ element ) {
        setTimeout( callback, 1000 / 60 );
      };
    }
  })();
}

function run() {
  var cachedToken = null;
  var cachedRoom = null;
  try {
    cachedToken = window.localStorage.getItem("blocklyio.reconnectToken");
    cachedRoom = window.localStorage.getItem("blocklyio.roomId");
  } catch (e) {
    cachedToken = null;
    cachedRoom = null;
  }

  client.connectGame('', $('#name').val(), function(success, msg) {
    if (success) 
    {
      $("#begin").addClass("hidden");
      $("#begin").animate({
          opacity: 0
      }, 1000);
    }
    else 
    {
      var error = $("#error");
      error.text(msg);
    }
  }, {
    reconnectToken: cachedToken || undefined,
    roomId: cachedRoom || undefined
  });
}

$(function() {
  var error = $("#error");
  
  if (!window.WebSocket)
  {
    error.text("Your browser does not support WebSockets!");
    return;
  }
  
  error.text("Loading..."); //TODO: show loading screen.
  var success = false;
  var socket = io(window.location.origin, {
    'forceNew': true,
    upgrade: false,
    transports: ['websocket']
  });
  
  socket.on('connect_error', function() {
    if (!success)
      error.text("Cannot connect with server. This probably is due to misconfigured proxy server. (Try using a different browser)");
  });
  socket.emit(protocol.EVENTS.CHECK_CONN, function(resp) {
    if (resp && resp.ok && resp.protocol === protocol.VERSION) {
      success = true;
    }
    socket.disconnect();
  });
  setTimeout(function() {
    if (!success)
      error.text("Cannot connect with server. This probably is due to misconfigured proxy server. (Try using a different browser)");
    else
    {
      error.text("");
      $("input").keypress(function(evt) {
        if (evt.which === 13)
          requestAnimationFrame(run);
      });
      $("button").click(function(evt) {
        requestAnimationFrame(run);
      });
    }
  }, 2000);
});

client.renderer = (function(oldRenderer) {
  var renderer = oldRenderer || {};
  var oldSession = renderer.session;
  renderer.session = function(session) {
    if (oldSession) {
      oldSession(session);
    }
    if (!session) {
      return;
    }
    try {
      window.localStorage.setItem("blocklyio.reconnectToken", session.reconnectToken || "");
      window.localStorage.setItem("blocklyio.roomId", session.roomId || "");
    } catch (e) {
      // no-op
    }
  };
  return renderer;
})(client.renderer);


//Event listeners
$(document).keydown(function(e) {
  var newHeading = -1;
  switch (e.which)
  {
    case 37: newHeading = 3; break; //LEFT
    case 65: newHeading = 3; break; //LEFT (A)

    case 38: newHeading = 0; break; //UP
    case 87: newHeading = 0; break; //UP (W)

    case 39: newHeading = 1; break; //RIGHT
    case 68: newHeading = 1; break; //RIGHT (D)

    case 40: newHeading = 2; break; //DOWN
    case 83: newHeading = 2; break; //DOWN (S)
    default: return; //exit handler for other keys.
  }
  
  client.changeHeading(newHeading);
  e.preventDefault();
});
