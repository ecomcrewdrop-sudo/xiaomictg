async function ping() {
  try {
    console.log("Fetching /api/orders...");
    const res = await fetch('https://www.xiaomicartagena.com/api/orders');
    console.log("Status:", res.status);
    const text = await res.text();
    console.log("Response:", text.substring(0, 300));

    console.log("\nFetching /api/products...");
    const res2 = await fetch('https://www.xiaomicartagena.com/api/products');
    console.log("Status:", res2.status);
    const text2 = await res2.text();
    console.log("Response:", text2.substring(0, 300));
  } catch (err) {
    console.error("Error:", err);
  }
}
ping();
