// Fixed mix levels. The scripts never improvise these: every video gets the same balance.
// Gain in dB applied to each SFX file (files are normalised to ~-1 dBFS peak).
export const SFX_GAIN_DB = {
  whoosh: -19,
  pop: -15,
  boom: -11,
  ding: -18,
  click: -20,
  riser: -21,
};
export const DEFAULT_SFX_GAIN_DB = -18; // for user-supplied sfx not in the table
export const MEME_AUDIO_GAIN_DB = -9;   // audio track of a video meme
export const VOICE_GAIN_DB = 0;

// Automatic SFX the scripts add on their own (same every time).
export const AUTO_SFX = {
  zoomIn: 'whoosh', // when a beat zooms in
  meme: 'pop',      // when a meme appears
};

// Delivery targets checked by QC.
export const LOUDNESS = { I: -14, TP: -1.5, LRA: 11, toleranceLU: 1.5, maxTruePeak: -1.0 };

// Where the "hit" sits inside each SFX file (s). The hit is aligned to the beat, not the file start.
export const SFX_HIT = { whoosh: 0.32, riser: 1.4, pop: 0, boom: 0, ding: 0, click: 0 };
