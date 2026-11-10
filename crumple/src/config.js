// Shared constants. Pure data: importable in node and in the browser.
// Units everywhere: metres, seconds, kilograms, radians. +Y is up.
//
// World frame is anchored to the bin: the bin's nominal centre sits on the floor at the
// origin. The player stands at +Z and throws toward -Z. +X is the player's right.

export const GAME_TITLE = 'Crumple League';

export const THROW = {
  height: 1.05, // ball release height above the floor
  elevationDeg: 48, // fixed launch elevation; power changes speed, not loft
  maxAimDeg: 32, // launch azimuth clamp either side of the bin line
  aimGain: 0.5, // launch azimuth = aimGain * flick angle
  powerClamp: [0.5, 1.8], // clamp on (flick speed / calibrated flick speed)
};

export const LIMITS = {
  minDistance: 2.0,
  maxDistance: 5.0,
  maxLateral: 1.0, // how far off the bin line the player can be placed
  maxFlightTime: 7.0,
};

export const ARCADE = {
  lives: 3,
  lifeBackEvery: 10, // a streak of this many returns one life (never above `lives`)
};

export const DAILY = {
  shots: 12,
  epochUTC: Date.UTC(2026, 0, 1), // Daily #1 is 2026-01-01 UTC
};

export const TARGET_SUCCESS = 0.85; // the make rate the adaptive difficulty steers toward
