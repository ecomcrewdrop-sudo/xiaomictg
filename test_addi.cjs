const fetch = require('node-fetch');

async function run() {
    try {
        const clientId = 'upT8WKxtMzHHtFI9SrWThPjjghzHkATy';
        const clientSecret = '1YB3cFJDfFyeEAxhKBGjPfvLeto1NIKygCPlKmDGCG1YD4eQG0rkLrH_DMFep_MP';
        
        console.log('1. Getting Token...');
        const tokenRes = await fetch('https://auth.addi.com/oauth/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                client_id: clientId,
                client_secret: clientSecret,
                grant_type: 'client_credentials',
                audience: 'https://api.addi-staging.com'
            })
        });
        
        const tokenData = await tokenRes.json();
        console.log('Token Response:', tokenData);
        
        if (!tokenData.access_token) {
            console.error('Failed to get token');
            return;
        }

        console.log('\n2. Creating Transaction...');
        const transactionRes = await fetch('https://api.addi-staging.com/v1/online-applications', {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${tokenData.access_token}`,
                'Content-Type': 'application/json'
            },
            redirect: 'manual', // Important: capture 301 Location
            body: JSON.stringify({
                orderId: "TEST-" + Date.now(),
                totalAmount: "100000.0",
                shippingAmount: "0.0",
                currency: "COP",
                items: [{
                    sku: "TEST-01",
                    name: "Test Item",
                    quantity: "1",
                    unitPrice: 100000
                }],
                client: {
                    idType: "CC",
                    idNumber: "123456789",
                    firstName: "Test",
                    lastName: "User",
                    email: "test@example.com",
                    cellphone: "3001234567",
                    cellphoneCountryCode: "+57",
                    address: {
                        lineOne: "Calle 1 # 2-3",
                        city: "Cartagena",
                        country: "CO"
                    }
                },
                allyUrlRedirection: {
                    logoUrl: "https://xiaomictg.com/logo.png",
                    callbackUrl: "https://xiaomictg-production.up.railway.app/api/addi/callback",
                    redirectionUrl: "https://xiaomictg-production.up.railway.app/success"
                }
            })
        });

        console.log('Transaction Status:', transactionRes.status, transactionRes.statusText);
        if (transactionRes.status === 301 || transactionRes.status === 302) {
            console.log('Location:', transactionRes.headers.get('location'));
        }
        const text = await transactionRes.text();
        console.log('Transaction Body:', text);

    } catch (e) {
        console.error(e);
    }
}
run();
