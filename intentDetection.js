const { ChatOpenAI } = require("@langchain/openai");
const { HumanMessage, SystemMessage } = require("@langchain/core/messages");
const dotenv = require("dotenv");

dotenv.config();

// OpenAI API Anahtarını Kullanarak Modeli Tanımla
const llm = new ChatOpenAI({
    openAIApiKey: process.env.OPENAI_API_KEY,
    modelName: "gpt-4o-mini",
    temperature: 0.0,
});

// Intent Algılama Fonksiyonu
async function detectIntent(userInput) {
    const messages = [
        new SystemMessage(
            `You are an intent detection agent. You can ONLY return one of these specific intents:
            - search_number
            - label_search
            - start_chat
            - count_contacts
            - unknown

            If the user's intention doesn't match exactly with these intents, return 'unknown'.
            Return ONLY the intent name, and data (number) nothing else.`
        ),
        new HumanMessage(
            userInput
        ),
    ];

    const response = await llm.invoke(messages);
    return response.content.trim();
}

(async () => {
    try {
        //console.log(await detectIntent("34343 numarasının etiketlerini görebilir miyim?")); // numara_sorgulama
        console.log(await detectIntent("Bisakah Anda mengidentifikasi nomor panggilan ini? 9434344")); // fiyat_sorgulama
        //console.log(await detectIntent("can i start a chat with this number? 3232323"));
        //console.log(await detectIntent("can i start a voip call with this number? 123123123"));
        //console.log(await detectIntent("Siparişim ne zaman gelir?"));
        //console.log(await detectIntent("How can i prevent spam sms?"));
        console.log(await detectIntent("How many people are in my contact list"));
        console.log(await detectIntent("Berapa banyak orang yang ada di daftar kontak saya di Getcontact?")); //ID
        console.log(await detectIntent("Сколько человек в моем списке контактов на Getcontact?")); //RU
        console.log(await detectIntent("Can you start a telco call with this number? 123123123"));
    } catch (error) {
        console.error("Hata:", error);
    }
})();

// Router

// Agent -> GTC -> 