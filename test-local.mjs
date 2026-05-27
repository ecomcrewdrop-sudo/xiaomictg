async function testLocal() {
  try {
    // Test login
    console.log("=== Test: POST /api/login ===");
    const res1 = await fetch('http://localhost:3001/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'xiaomi2024' })
    });
    console.log("Status:", res1.status);
    const json1 = await res1.json();
    console.log("Response:", json1);

    // Test orders
    console.log("\n=== Test: GET /api/orders ===");
    const res2 = await fetch('http://localhost:3001/api/orders');
    console.log("Status:", res2.status);
    const json2 = await res2.json();
    console.log("Total orders:", json2.length);
    if (json2.length > 0) {
      console.log("First order number:", json2[0].orderNumber);
    }

    // Test products
    console.log("\n=== Test: GET /api/products ===");
    const res3 = await fetch('http://localhost:3001/api/products');
    console.log("Status:", res3.status);
    const json3 = await res3.json();
    console.log("Total products:", json3.length);
  } catch (err) {
    console.error("Error:", err.message);
  }
}
testLocal();
