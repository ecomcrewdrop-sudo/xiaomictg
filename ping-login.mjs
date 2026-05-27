async function pingLogin() {
  try {
    // Test 1: Is the server alive at all?
    console.log("=== Test 1: Ping /api/products ===");
    const controller1 = new AbortController();
    const timeout1 = setTimeout(() => controller1.abort(), 15000);
    const res1 = await fetch('https://www.xiaomicartagena.com/api/products', { signal: controller1.signal });
    clearTimeout(timeout1);
    console.log("Status:", res1.status);
    const text1 = await res1.text();
    console.log("Response (first 200 chars):", text1.substring(0, 200));
    
    // Test 2: Try login
    console.log("\n=== Test 2: POST /api/login ===");
    const controller2 = new AbortController();
    const timeout2 = setTimeout(() => controller2.abort(), 15000);
    const res2 = await fetch('https://www.xiaomicartagena.com/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'xiaomi2024' }),
      signal: controller2.signal
    });
    clearTimeout(timeout2);
    console.log("Status:", res2.status);
    const text2 = await res2.text();
    console.log("Response:", text2.substring(0, 300));

  } catch (err) {
    console.error("Error:", err.message || err);
  }
}
pingLogin();
