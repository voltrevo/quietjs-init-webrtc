'use strict';

const QuietConn = (side, rawSend) => {
  const conn = {};
  let canSend = (side === 'con');
  const buf = [];

  conn.side = side;

  conn.receive = (msg) => {
    if (!conn.onmsg) {
      return;
    }

    msg.forEach(m => conn.onmsg(m));

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

  Quiet.receiver({
    profile: 'audible',
    onReceive: (recvPayload) => {
      const msg = Quiet.ab2str(recvPayload);

      if (conn) {
        if (msg[3] === '[' && (msg.substring(0, 3) === 'ack') === sentInitConn) {
          conn.receive(JSON.parse(msg.substring(3)));
        }
      } else {
        if (sentInitConn) {
          if (msg === 'init-ack') {
            conn = QuietConn('con', msg => transmit.transmit(Quiet.str2ab('con' + JSON.stringify(msg))));
            ConnectionAcquired(conn);
          }
        } else {
          if (msg === 'init-con') {
            transmit.transmit(Quiet.str2ab('init-ack'));
            conn = QuietConn('ack', msg => transmit.transmit(Quiet.str2ab('ack' + JSON.stringify(msg))));
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
  const rand = Math.random();
  console.log('sending:', rand);
  conn.send(rand);
  conn.onmsg = (msg) => console.log('received:', msg);
}
