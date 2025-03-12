const axios = require('axios');

class InternalAPI {
    constructor(baseURL) {
        this.client = axios.create({
            baseURL,
            timeout: 5000,
            // diğer konfigürasyonlar...
        });
    }

    async searchNumber(number) {
        const response = await this.client.get(`/search/${number}`);
        return response.data;
    }

    async searchLabels(query) {
        //const response = await this.client.get(`/labels`, { params: { query } });
        //return response.data;
        return [
            'metin', 'metina'
        ]
    }
}

module.exports = new InternalAPI(process.env.INTERNAL_API_URL); 