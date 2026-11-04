export function createProbeOutput(limit = 512000) {
  let output = '', outputTruncated = false;
  return {
    collect(bytes) {
      const chunk = bytes.toString();
      const remaining = limit - output.length;
      if (chunk.length > remaining) outputTruncated = true;
      output += chunk.slice(0, remaining);
    },
    snapshot() { return { output, outputTruncated }; },
  };
}

export function refusalOutputFailed(result) {
  return result.code !== 0 || result.timedOut || result.outputTruncated ||
    result.output.includes('RESPONSE_BODY_MUST_STAY_PRIVATE') ||
    result.output.includes('response-private.example.test');
}
