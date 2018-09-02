const Discord = require("discord.js");
const ffmpeg = require('fluent-ffmpeg');
const WitSpeech = require('node-witai-speech');
const decode = require('./decodeOpus.js');
const fs = require('fs');
const path = require('path');
const tts = require('google-tts-api');
const colors = require('colors/safe');

var config = JSON.parse(fs.readFileSync("./settings.json", "utf-8"));

const WIT_API_KEY = config.wit_api_key;
const prefix = config.prefix;
const discord_token = config.discord_token;
const content_type = config.content_type;

const client = new Discord.Client();
const recordingsPath = makeDir('./recordings');
var voiceChannel = null;
var textChannel = null;
var listenConnection = null;
var listenReceiver = null;
var listenStreams = new Map();
var listening = false;

client.login(discord_token);

client.on('ready', handleReady.bind(this));

client.on('message', handleMessage.bind(this));

client.on('guildMemberSpeaking', handleSpeaking.bind(this));

ffmpeg.setFfmpegPath(path.resolve(__dirname, 'node_modules', 'ffmpeg-binaries', 'bin', 'ffmpeg.exe'));

function handleReady() {
  console.log(colors.green("Started with ") + colors.yellow(client.guilds.size) + colors.green(" guilds and ") + colors.yellow(client.users.size) + colors.green(" members"));
}

function handleMessage(message) {
  if (!message.content.startsWith(prefix)) {
    return;
  }

  var command = message.content.toLowerCase().slice(1).split(' ')[0];

  switch (command) {
    case 'ping':
      speakingPing(message);
      break;
    case 'listen':
      commandListen(message);
      break;
    case 'stop':
      commandStop(message);
      break;
    case 'help':
      commandHelp(message);
      break;
  }
}

function handleSpeech(member, speech) {
  var command = speech.toLowerCase().split(' ')[0];

  switch (command) {
    case 'i':
      speakingPing();
      break;
    case 'listen':
      speakingListen();
      break;
    case 'stop':
      speakingStop();
      break;
    case 'help':
      speakingHelp();
      break;
  }
}

function handleSpeaking(member, speaking) {
  if (!speaking && member.voiceChannel) {

    let stream = listenStreams.get(member.id);
    if (stream) {
      listenStreams.delete(member.id);
      stream.end(err => {
        if (err) {
          console.error('[ERROR] '.red + err);
        }

        let basename = path.basename(stream.path, '.opus_string');
        decode.convertOpusStringToRawPCM(stream.path, basename, (() => {

          processRawToWav(
            path.join('./recordings', basename + '.raw_pcm'),
            path.join('./recordings', basename + '.wav'), (function (data) {
              if (data != null) {
                handleSpeech(member, data._text);

                console.log(colors.cyan("[TEXT] ") + colors.bold(data._text));
                deleteFile(path.join('./recordings', basename + '.opus_string'));
                deleteFile(path.join('./recordings', basename + '.raw_pcm'));
                deleteFile(path.join('./recordings', basename + '.wav'));
              }
            }).bind(this));

        }).bind(this));
      });
    }

  }
}

function commandPing(message) {
  message.channel.send({ embed: {"title": ':ping_pong: Pong!', "color": 0x41aff4} })
}

function speakingPing(message) {
  tts('Pong!', `en`, 1).then((url) => {
    const voiceChannel = message.member.voiceChannel;
    voiceChannel.join().then(connection => {
    const dispatcher = connection.playStream(url); 
    dispatcher.on('end', () => {});
    });
  });
}

function commandListen(message) {
  member = message.member;
  if (!member) {
    return;
  }

  if (!member.voiceChannel) {
    message.delete(5000);
    message.channel.send({
      embed: {
        "title": "Error",
        "description": 'You need to be in a voice channel first',
        "color": 0xff2222
      }
    }).then(msg => {msg.delete(5000)});
    return;
  }
  if (listening) {
    message.delete(5000);
    message.channel.send({
      embed: {
        "title": "Error",
        "description": 'Already listening in **' + member.voiceChannel.name + '**',
        "color": 0xff2222
      }
    }).then(msg => {msg.delete(5000)});
    return;
  }

  listening = true;
  voiceChannel = member.voiceChannel;
  message.delete(5000);
  message.channel.send({
    embed: {
      "title": "Listening",
      "description": 'Started listening in to **' + member.voiceChannel.name + '**',
      "color": 0x42f4a1
    }
  }).then(msg => {msg.delete(5000)});

  var recordingsPath = path.join('.', 'recordings');
  makeDir(recordingsPath);

  voiceChannel.join().then((connection) => {
    listenConnection = connection;

    let receiver = connection.createReceiver();
    receiver.on('opus', function (user, data) {
      let hexString = data.toString('hex');
      let stream = listenStreams.get(user.id);
      if (!stream) {
        if (hexString === 'f8fffe') {
          return;
        }
        let outputPath = path.join(recordingsPath, `${user.id}-${Date.now()}.opus_string`);
        stream = fs.createWriteStream(outputPath);
        listenStreams.set(user.id, stream);
      }
      stream.write(`,${hexString}`);
    });
    listenReceiver = receiver;
  }).catch(console.error);
}

function commandStop(message) {
  if (!voiceChannel) {
    message.delete(5000);
    message.channel.send({
      embed: {
        "title": "Error",
        "description": 'Already stopped listening',
        "color": 0xff2222
      }
    }).then(msg => {msg.delete(5000)});
    return;
  }

  listening = false;
  if (listenReceiver) {
    listenReceiver.destroy();
    listenReceiver = null;
  }
  if (listenConnection) {
    listenConnection.disconnect();
    listenConnection = null;
  }
  if (voiceChannel) {
    voiceChannel.leave();
    voiceChannel = null;
  }

  message.delete(5000);
  message.channel.send({
    embed: {
      "title": "End",
      "description": "Stopped listening and left",
      "color": 0xf4b841
    }
  }).then(msg => {msg.delete(5000)});
}

function processRawToWav(filepath, outputpath, cb) {
  fs.closeSync(fs.openSync(outputpath, 'w'));
  var command = ffmpeg(filepath)
    .addInputOptions([
      '-f s32le',
      '-ar 48k',
      '-ac 1'
    ])
    .on('end', function () {
      // Stream the file to be sent to the wit.ai
      var stream = fs.createReadStream(outputpath);

      // Its best to return a promise
      var parseSpeech = new Promise((resolve, reject) => {
        // call the wit.ai api with the created stream
        WitSpeech.extractSpeechIntent(WIT_API_KEY, stream, content_type,
          (err, res) => {
            if (err) return reject(err);
            resolve(res);
          });
      });

      // check in the promise for the completion of call to witai
      parseSpeech.then((data) => {
          cb(data);
        })
        .catch((err) => {
          let basename = path.basename(stream.path, '.opus_string').slice(0, -4);
          deleteFile(path.join('./recordings', basename + '.opus_string'));
          deleteFile(path.join('./recordings', basename + '.raw_pcm'));
          deleteFile(path.join('./recordings', basename + '.wav'));
          cb(null);
        });
    })
    .on('error', function (err) {
      console.log(colors.red('[ERROR] ' + err.message));
    })
    .addOutput(outputpath)
    .run();
}

function makeDir(dir) {
  try {
    fs.mkdirSync(dir);
  } catch (err) {}
}

function deleteFile(path) {
  try {
    fs.unlinkSync(path);
  } catch (err) {}
}