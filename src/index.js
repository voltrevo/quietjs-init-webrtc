'use strict';

const QuietConn = (side, rawSend) => {
  const conn = {};
  let canSend = (side === 'con');
  const buf = [];

  conn.side = side;

  conn.receive = (msg) => {
    if (conn.onmsg) {
      msg.forEach(m => conn.onmsg(m));
    }

    setTimeout(() => {
      if (buf.length === 0) {
        canSend = true;
        return;
      }

      rawSend(buf);
      buf.length = 0;
    });
  };

  const trySend = () => {
    if (!canSend) {
      return;
    }

    canSend = false;
    rawSend(buf);
    buf.length = 0;
  };

  conn.send = (msg) => {
    buf.push(msg);
    setTimeout(trySend);
  };

  return conn;
};

(async () => {
  Quiet.init({
    profilesPrefix: '/',
    memoryInitializerPrefix: '/',
    libfecPrefix: '/',
  });

  await new Promise((resolve, reject) => Quiet.addReadyCallback(resolve, reject));

  const transmit = Quiet.transmitter({ profile: 'audible', onFinish: () => {} });
  let conn = null;
  let sentInitConn = false;
  let recvBuffer = null;

  Quiet.receiver({
    profile: 'audible',
    onReceive: (recvPayload) => {
      const msg = Quiet.ab2str(recvPayload);

      if (conn) {
        if (recvBuffer || (msg[3] === '[' && (msg.substring(0, 3) === 'ack') === sentInitConn)) {
          if (!recvBuffer) {
            recvBuffer = new ArrayBuffer(0);
          }

          recvBuffer = Quiet.mergeab(recvBuffer, recvPayload);

          if (msg[msg.length - 1] === '\n') {
            const completeMsg = Quiet.ab2str(recvBuffer);
            recvBuffer = null;
            conn.receive(JSON.parse(completeMsg.substring(3, completeMsg.length - 1)));
            console.log('received:', JSON.stringify(completeMsg));
          } else {
            console.log('received part:', JSON.stringify(msg));
          }
        }
      } else {
        console.log('received startup msg', msg);
        if (sentInitConn) {
          if (msg === 'init-ack') {
            conn = QuietConn('con', (msg) => {
              const strMsg = 'con' + JSON.stringify(msg) + '\n';
              console.log('sending:', JSON.stringify(strMsg));
              transmit.transmit(Quiet.str2ab(strMsg));
            });
            ConnectionAcquired(conn);
          }
        } else {
          if (msg === 'init-con') {
            transmit.transmit(Quiet.str2ab('init-ack'));
            conn = QuietConn('ack', (msg) => {
              const strMsg = 'ack' + JSON.stringify(msg) + '\n';
              console.log('sending:', JSON.stringify(strMsg));
              transmit.transmit(Quiet.str2ab(strMsg));
            });
            ConnectionAcquired(conn);
          }
        }
      }
    },
    onCreateFail: (reason) => console.error(`Failed to create receiver: ${reason}`),
    onReceiveFail: (numFails) => console.error(`Failed to receive (${numFails})`),
  })

  document.querySelector('#start-btn').addEventListener('click', () => {
    sentInitConn = true;
    transmit.transmit(Quiet.str2ab('init-con'));
  });
})()
  .catch(err => console.error(err))
;

function ConnectionAcquired(conn) {
  const pc = new RTCPeerConnection({});

  const streamPromise = navigator.mediaDevices.getUserMedia({ video: true, audio: true })
    .then((stream) => {
      document.querySelector('#local-video').srcObject = stream;

      if (pc.addTrack) {
        stream.getTracks.forEach(track => pc.addTrack(track));
      } else {
        pc.addStream(stream);
      }

      if (conn.side === 'con') {
        pc.createOffer().then((offer) => {
          pc.setLocalDescription(offer);
          conn.send({ type: 'offer', content: offer })
        });
      }
    })
  ;

  conn.onmsg = (msg) => {
    if (msg.type === 'candidate') {
      pc.addIceCandidate(msg.content);
    } else if (msg.type === 'offer') {
      pc.setRemoteDescription(msg.content);

      streamPromise
        .then(() => pc.createAnswer())
        .then((answer) => {
          pc.setLocalDescription(answer);
          conn.send({ type: 'answer', content: answer })
        })
      ;
    } else if (msg.type === 'answer') {
      pc.setRemoteDescription(msg.content);
    }
  }

  pc.addEventListener('icecandidate', (evt) => {
    if (evt.candidate) {
      conn.send({ type: 'candidate', content: evt.candidate });
    }
  });

  pc.addEventListener('addstream', (evt) => {
    document.querySelector('#remote-video').srcObject = evt.stream;
  });

  pc.addEventListener('track', (evt) => {
    document.querySelector('#remote-video').srcObject = evt.streams[0];
  });
}
