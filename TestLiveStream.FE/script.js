const configuration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

let connection = null;
let peerConnections = {};
let localStream = null;
let isHost = false;
let roomId = "";

async function initConnection() {
  connection = new signalR.HubConnectionBuilder()
    .withUrl("http://localhost:9000/livestreamHub", {
      withCredentials: false,
    })
    .withAutomaticReconnect()
    .configureLogging(signalR.LogLevel.Information)
    .build();

  connection.on("ReceiveMessage", handleMessage);
  connection.on("UserJoined", handleUserJoined);
  connection.on("UserLeft", handleUserLeft);
  connection.on("ConnectionStatus", (statusMessage) => {
    updateStatus(statusMessage);
  });

  connection.on("HostJoined", (message) => {
    console.log("Host has joined: ", message);
  });

  try {
    await connection.start();
    updateStatus("Connected to signaling server.");
  } catch (err) {
    console.error("SignalR Connection Error:", err);
    updateStatus("Failed to connect to signaling server.");
  }
}

function updateStatus(message) {
  const statusElement = document.getElementById("connectionStatus");
  statusElement.textContent = `Connection Status: ${message}`;
}

async function startLivestream() {
  isHost = true;
  roomId = document.getElementById("roomInput").value;

  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true,
    });

    document.getElementById("hostVideo").srcObject = localStream;

    await connection.invoke("JoinRoom", roomId, true);
    updateStatus(`Livestream started in room: ${roomId}`);
  } catch (err) {
    console.error("Error starting livestream:", err);
    updateStatus("Failed to start livestream.");
  }
}

async function joinLivestream() {
  isHost = false;
  roomId = document.getElementById("roomInput").value;

  try {
    await connection.invoke("JoinRoom", roomId, false);
    updateStatus(`Joined livestream in room: ${roomId}`);
  } catch (err) {
    console.error("Error joining livestream:", err);
    updateStatus("Failed to join livestream.");
  }
}

async function handleUserJoined(userId) {
  if (isHost) {
    const peerConnection = createPeerConnection(userId);

    // Add local stream tracks to the connection
    localStream
      .getTracks()
      .forEach((track) => peerConnection.addTrack(track, localStream));

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    connection.invoke(
      "SendMessage",
      roomId,
      JSON.stringify({ type: "offer", offer, userId })
    );
  }
}

function createPeerConnection(userId) {
  const peerConnection = new RTCPeerConnection(configuration);

  // Queue for ICE candidates until remote description is set
  peerConnection.queuedCandidates = [];

  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      connection.invoke(
        "SendMessage",
        roomId,
        JSON.stringify({
          type: "candidate",
          candidate: event.candidate,
          userId,
        })
      );
    }
  };

  peerConnection.ontrack = (event) => {
    const remoteStream = new MediaStream();
    event.streams[0]
      .getTracks()
      .forEach((track) => remoteStream.addTrack(track));

    const videoElement = document.getElementById(
      isHost ? "hostVideo" : "viewerVideo"
    );
    videoElement.srcObject = remoteStream;

    videoElement
      .play()
      .catch((err) => console.error("Error playing remote stream:", err));
  };

  peerConnection.oniceconnectionstatechange = () => {
    console.log(
      `ICE Connection State for ${userId}: ${peerConnection.iceConnectionState}`
    );
  };

  peerConnections[userId] = peerConnection;
  return peerConnection;
}

async function handleMessage(message) {
  const data = JSON.parse(message);
  const { type, userId, offer, answer, candidate } = data;

  const peerConnection =
    peerConnections[userId] || createPeerConnection(userId);

  if (type === "offer") {
    if (peerConnection.signalingState !== "stable") {
      console.warn("Queueing offer because the signaling state is not stable.");
      peerConnection.queuedOffer = offer; // Save the offer for later
      return;
    }

    try {
      await peerConnection.setRemoteDescription(
        new RTCSessionDescription(offer)
      );

      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);

      connection.invoke(
        "SendMessage",
        roomId,
        JSON.stringify({
          type: "answer",
          answer: peerConnection.localDescription,
          userId,
        })
      );
    } catch (error) {
      console.error("Error handling offer:", error);
    }
  } else if (type === "answer") {
    try {
      if (peerConnection.signalingState !== "have-local-offer") {
        console.warn(
          "Queueing answer because the signaling state is not have-local-offer."
        );
        return;
      }

      await peerConnection.setRemoteDescription(
        new RTCSessionDescription(answer)
      );

      // Process any queued ICE candidates
      if (peerConnection.queuedCandidates) {
        peerConnection.queuedCandidates.forEach((candidate) =>
          peerConnection.addIceCandidate(candidate)
        );
        peerConnection.queuedCandidates = [];
      }
    } catch (error) {
      console.error("Error handling answer:", error);
    }
  } else if (type === "candidate") {
    try {
      if (!peerConnection.remoteDescription) {
        console.warn(
          "Queueing ICE candidate because remote description is not set."
        );
        peerConnection.queuedCandidates.push(new RTCIceCandidate(candidate));
      } else {
        await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
      }
    } catch (error) {
      console.error("Error adding ICE candidate:", error);
    }
  }
}

function handleUserLeft(userId) {
  if (peerConnections[userId]) {
    peerConnections[userId].close();
    delete peerConnections[userId];
    updateStatus(`User ${userId} left the room.`);
  }
}

initConnection();
