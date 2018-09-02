'use strict';

const fs = require('fs');
const path = require('path');
const opus = require('node-opus');

const rate = 48000;
const frame_size = 1920;
const channels = 2;

let getDecodedFrame = (frameString, encoder, filename) => {
	let buffer = Buffer.from(frameString, 'hex');
	try {
		buffer = encoder.decode(buffer, frame_size);
	} catch (err) {
		try {
			buffer = encoder.decode(buffer.slice(8), frame_size);
		} catch (err) {
			console.log(`[ERROR]`.red + `${filename} was unable to be decoded`);
			return null;
		}
	}
	return buffer;
};

let convertOpusStringToRawPCM = (inputPath, filename, cb) => {
	let encoder = new opus.OpusEncoder(rate, channels);
	const inputStream = fs.createReadStream(inputPath);
	const outputStream = fs.createWriteStream(path.join(path.dirname(inputPath), `${filename}.raw_pcm`));
	let data = '';
	inputStream.on('data', chunk => {
		data += chunk.toString();
		const frames = data.split(',');
		if (frames.length) {
			data = frames.pop();
		}
		for (let frame of frames) {
			if (frame !== '') {
				const decodedBuffer = getDecodedFrame(frame, encoder, filename);
				if (decodedBuffer) {
					outputStream.write(decodedBuffer);
				}
			}
		}
	});
	inputStream.on('end', () => {
		outputStream.end((err) => {
			if (err) {
				console.error('[ERROR] '.red + err);
			}
		});
	});
	cb();
};

let convertAllOpusStringToRawPCM = (inputDirectory) => {
	fs.readdir(inputDirectory, (err, files) => {
		if (err) {
			console.error('[ERROR] Cant read because of: '.red + err);
		} else {
			files.forEach((file) => {
				let ext = path.extname(file);
				if (ext === '.opus_string') {
					convertOpusStringToRawPCM(path.join(inputDirectory, file), path.basename(file, ext));
				}
			});
		}
	});
};

module.exports = {
	convertOpusStringToRawPCM: convertOpusStringToRawPCM
}