import { DynamicTool } from "langchain/tools";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config(); // .env dosyasını yükle

// Internal API çağrısı yapan tool
const getWeatherTool = new DynamicTool({
    name: "get_weather",
    description: "Belirtilen şehir için hava durumu bilgisini getirir.",
    func: async (location) => {
        try {
            const API_URL = `http://internal-api.local/weather?location=${location}`;
            const response = await axios.get(API_URL);
            return response.data.weather || "Hava durumu bilgisi alınamadı.";
        } catch (error) {
            return "API çağrısı başarısız oldu.";
        }
    },
});

export { getWeatherTool };
