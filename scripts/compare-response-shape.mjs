import assert from "node:assert/strict";

export function compareResponseShape(expected, actual) {
  const errors = [];
  compareShape(expected, actual, "$", errors);
  if (errors.length) assert.fail(`Live response shape differs from fixture:\n${errors.join("\n")}`);
}

function compareShape(expected, actual, path, errors) {
  if (expected === null) {
    if (actual !== null) errors.push(`${path}: expected null, received ${typeOf(actual)}`);
    return;
  }

  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) {
      errors.push(`${path}: expected array, received ${typeOf(actual)}`);
      return;
    }
    for (let index = 0; index < Math.min(expected.length, actual.length); index += 1) {
      compareShape(expected[index], actual[index], `${path}[${index}]`, errors);
    }
    return;
  }

  if (typeof expected === "object") {
    if (typeOf(actual) !== "object") {
      errors.push(`${path}: expected object, received ${typeOf(actual)}`);
      return;
    }
    const expectedKeys = Object.keys(expected).sort();
    const actualKeys = Object.keys(actual).sort();
    if (JSON.stringify(expectedKeys) !== JSON.stringify(actualKeys)) {
      errors.push(`${path}: keys differ\n  fixture: ${expectedKeys.join(", ")}\n  live: ${actualKeys.join(", ")}`);
    }
    for (const key of expectedKeys.filter((key) => key in actual)) {
      compareShape(expected[key], actual[key], `${path}.${key}`, errors);
    }
    return;
  }

  if (typeof expected !== typeof actual) {
    errors.push(`${path}: expected ${typeof expected}, received ${typeOf(actual)}`);
  }
}

function typeOf(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}
