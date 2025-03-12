const { ChatOpenAI } = require("@langchain/openai");
const fs = require("fs");
const dotenv = require("dotenv");

//sendBotMessage 

dotenv.config();

// OpenAI API Anahtarı

// Görseli GPT Vision API'ye göndererek nesneleri tespit et
async function detectObjectsWithGPT(imagePath) {
    try {
        // Görseli base64'e çevir
        const imageBuffer = fs.readFileSync(imagePath);
        const base64Image = imageBuffer.toString('base64');

        const llm = new ChatOpenAI({
            openAIApiKey: process.env.OPENAI_API_KEY,
            modelName: "gpt-4o",
            temperature: 0.0,
        });

        const prompt = [{
            role: "user",
            content: [
                { type: "text", text: "Bu görselde taşıt plakası var mı?. Var ise sadece plakayı yok ise unknown yaz. Tespit edebilirsen araç markasını ve modelini de ver." },
                {
                    type: "image_url",
                    image_url: {
                        //url: "https://applaka.com/wp-content/uploads/2023/06/mercedes-c180-app-plaka.jpg",
                        url: "https://i0.shbdn.com/photos/22/96/87/x5_1230229687i6m.jpg"
                    }
                }
            ]
        }];

        const response = await llm.invoke(prompt);
        console.log(response.content);
        console.log(response.response_metadata.tokenUsage);
        // Virgülle ayrılmış string'i diziye çevir
        //const objects = response.split(',').map(item => item.trim());
        // return objects;
    } catch (error) {
        console.error('❌ GPT Vision API hatası:', error.message);
        return [];
    }
}

// GPT-4 ile nesneleri açıklama yaptır
async function describeObjects(objects) {
    try {
        const llm = new OpenAI({
            modelName: 'gpt-4',
            openAIApiKey: process.env.OPENAI_API_KEY,
        });

        const prompt = `Bu nesneler hakkında detaylı bilgi ver: ${objects.join(', ')}.`;
        const response = await llm.call(prompt);
        return response;
    } catch (error) {
        console.error('❌ GPT-4 API hatası:', error.message);
        return 'Açıklama oluşturulamadı.';
    }
}

// Ana fonksiyon
async function processImage(imagePath) {
    try {
        console.log('🔍 Görsel dosyası:', imagePath);
        if (!fs.existsSync(imagePath)) {
            throw new Error('Görsel dosyası bulunamadı');
        }

        const objects = await detectObjectsWithGPT(imagePath);
        /*
                console.log('🔍 Algılanan Nesneler:', objects);
        
                if (objects.length === 0) {
                    console.log('⚠ Hiç nesne bulunamadı.');
                    return;
                }
        */
        //const description = await describeObjects(objects);
        //console.log('📖 Açıklama:', description);
    } catch (error) {
        console.error('❌ İşlem hatası:', error.message);
    }
}

// Test için görseli işle
async function main() {
    await processImage("./image.png");
}

main();