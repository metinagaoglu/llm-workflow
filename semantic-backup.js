const { ChatOpenAI } = require("@langchain/openai");
const { StateGraph, Annotation, Send } = require("@langchain/langgraph");
const { z } = require("zod");
const dotenv = require("dotenv");
const readline = require('readline');
const client = require("./mongoClient.js");
const { MongoDBSaver } = require("@langchain/langgraph-checkpoint-mongodb");

dotenv.config();

// MongoDB veritabanı ve koleksiyon adları
const dbName = "langgraphDB";
const collectionName = "checkpoints";

// MongoDB checkpointer'ını oluşturun
const checkpointer = new MongoDBSaver({
    client,
    dbName,
    collectionName,
    serializeState: (state) => {
        // State'i JSON'a çevirip saklama
        return JSON.stringify(state);
    },
    deserializeState: (serializedState) => {
        // JSON'dan state'i geri yükleme
        return JSON.parse(serializedState);
    }
});


const llm = new ChatOpenAI({
    openAIApiKey: process.env.OPENAI_API_KEY,
    modelName: "gpt-4",
    temperature: 0.0,
});

// Intent schema
const routeSchema = z.object({
    intents: z.array(z.enum(["search_number", "add_spam", "label_search", "start_chat", "count_contacts", "unknown"]))
});

const router = llm.withStructuredOutput(routeSchema);

// Graph state
const StateAnnotation = Annotation.Root({
    input: Annotation,
    intents: Annotation,
    completedTasks: Annotation({
        default: () => [],
        reducer: (a, b) => a.concat(b),
    }),
    finalResponse: Annotation,
    thread_id: Annotation,
    userId: Annotation
});

// Worker state
const WorkerStateAnnotation = Annotation.Root({
    input: Annotation,
    task: Annotation,
    completedTasks: Annotation({
        default: () => [],
        reducer: (a, b) => a.concat(b),
    }),
    thread_id: Annotation,
});

async function orchestrator(state) {
    console.log(state)
    const userId = state.configurable?.user_id;

    // Kullanıcı profilini ve önceki etkileşimlerini getirme
    const userProfile = await client.db(dbName).collection("userProfiles").findOne({ user_id: userId });
    const interactionHistory = await client.db(dbName).collection("userInteractions").find({ user_id: userId }).sort({ timestamp: -1 }).limit(5).toArray();

    // Etkileşim geçmişini LLM bağlamına uygun şekilde formatlama
    const formattedHistory = interactionHistory.map(interaction => ({
        role: interaction.role,
        content: interaction.content
    }));

    // LLM'ye gönderilecek mesajı oluşturma
    const llmInput = [
        {
            role: "system",
            content: `Kullanıcı profili: ${JSON.stringify(userProfile)}. Önceki etkileşimler: ${JSON.stringify(formattedHistory)}.`
        },
        {
            role: "user",
            content: state.input
        }
    ];

    // LLM'den yanıt alma
    const decision = await router.invoke(llmInput);

    // Yeni etkileşimi kaydetme
    await client.db(dbName).collection("userInteractions").insertOne({
        user_id: userId,
        role: "user",
        content: state.input,
        timestamp: new Date()
    });

    return {
        intents: decision.intents,
        input: state.input,
        thread_id: state.config?.thread_id,
        userId
    };
}


// Profil node'u için annotation
const ProfileAnnotation = Annotation.Root({
    user_id: Annotation,
    name: Annotation,
    preferences: Annotation,
    interactionHistory: Annotation({
        default: () => [],
        reducer: (a, b) => a.concat(b),
    }),
});

async function profileManager(state) {
    // Kullanıcı mesajını analiz et
    const userMessage = state.input;
    const profile = await client
        .db(dbName)
        .collection("userProfiles")
        .findOne({ user_id: state.user_id });

    // Profil bilgilerini güncelle
    const updatedProfile = { ...profile, interactionHistory: [...profile.interactionHistory, userMessage] };
    await client
        .db(dbName)
        .collection("userProfiles")
        .updateOne(
            { user_id: state.user_id },
            { $set: updatedProfile }
        );

    // LLM'e profil bilgileriyle birlikte mesajı ilet
    const result = await llm.invoke([
        {
            role: "system",
            content: `Profil bilgileri: ${JSON.stringify(updatedProfile)}. Kullanıcı mesajı: ${userMessage}`
        }
    ]);

    return { response: result.content, profile: updatedProfile };
}

// Mock handler functions
async function handleSearchNumber(input) {
    return "Bu numara hakkında bilgi bulunamadı.";
}

async function handleChatBot(input) {
    const result = await llm.invoke([
        {
            role: "system",
            content: "Sen yardımcı bir asistansın. Türkçe olarak cevap ver. Nazik ve yardımsever ol. Kullanıcının profile bilgileri burada: " + input.profile
        },
        {
            role: "user",
            content: input
        }
    ]);

    return result.content;
}

async function handleLabelSearch(input) {
    return "Bu numara için etiketler: 'Market', 'Pizza Dükkanı'";
}

async function handleCountContacts(input) {
    return "Kişi listenizde 150 kişi bulunmaktadır.";
}

async function handleAddSpam(input) {
    return "Numara spam olarak işaretlendi.";
}

async function agentWorker(state) {
    const userId = state.userId;
    // Kullanıcı profilini getir
    const userProfile = state.profile || await client.db(dbName).collection("userProfiles").findOne({ user_id: userId });

    // LLM'e gönderilecek sistem mesajını profil bilgileriyle zenginleştir
    const systemMessage = `
        Kullanıcı Profili: ${JSON.stringify(userProfile)}
        Sen yardımcı bir asistansın. Türkçe olarak cevap ver. 
        Kullanıcının profilindeki bilgileri göz önünde bulundurarak kişiselleştirilmiş yanıtlar ver.
    `;

    let result;
    switch (state.task) {
        case "search_number":
            result = { content: await handleSearchNumber(state.input) };
            break;
        case "label_search":
            result = { content: await handleLabelSearch(state.input) };
            break;
        case "count_contacts":
            result = { content: await handleCountContacts(state.input) };
            break;
        case "add_spam":
            result = { content: await handleAddSpam(state.input) };
            break;
        case "unknown":
        default:
            result = await llm.invoke([
                {
                    role: "system",
                    content: systemMessage
                },
                {
                    role: "user",
                    content: state.input
                }
            ]);
            break;
    }

    await client.db(dbName).collection("userInteractions").insertOne({
        user_id: userId,
        role: "assistant",
        content: result.content,
        timestamp: new Date()
    });

    return { completedTasks: [`${state.task}: ${result.content}`] };
}

async function synthesizer(state) {
    const completedTasks = state.completedTasks;

    const result = await llm.invoke([
        {
            role: "system",
            content: "You are a response synthesizer. Combine multiple task results into a coherent, unified response. If there are multiple actions requested, explain each result clearly. Append the is there any other action to be done nicely. Use this countrys language: TR"
        },
        {
            role: "user",
            content: `Here are the task results to combine: ${JSON.stringify(completedTasks)}`
        }
    ]);

    return {
        finalResponse: result.content,
        thread_id: state.thread_id
    };
}

// Kişisel bilgi tanıma node'u
async function personalInfoDetector(state) {
    const userMessage = state.input;
    const userId = state.userId;

    // Mevcut kullanıcı profilini getir
    const userProfile = await client.db(dbName).collection("userProfiles").findOne({ user_id: userId });

    // LLM'e profil bilgilerini de içeren context ver
    const result = await llm.invoke([
        {
            role: "system",
            content: `Mevcut profil bilgileri: ${JSON.stringify(userProfile)}
            Kullanıcının mesajında kişisel bilgiler (isim, telefon numarası, e-posta, adres, doğum tarihi vb.) olup olmadığını tespit et. 
            Varsa, bu bilgileri JSON formatında döndür. Yoksa boş bir JSON döndür.`
        },
        {
            role: "user",
            content: userMessage
        }
    ]);

    try {
        const personalInfo = JSON.parse(result.content);

        if (Object.keys(personalInfo).length > 0) {
            // Profili güncelle - kişisel bilgileri ekle/güncelle
            const updatedProfile = {
                user_id: userId,  // user_id'yi açıkça belirt
                ...userProfile,   // mevcut profil bilgilerini koru
                ...personalInfo,  // yeni kişisel bilgileri ekle
                lastUpdated: new Date(),
                detectedPersonalInfo: [
                    ...(userProfile?.detectedPersonalInfo || []),
                    {
                        timestamp: new Date(),
                        info: personalInfo
                    }
                ]
            };

            // Profili güncelle veya oluştur
            await client.db(dbName).collection("userProfiles").updateOne(
                { user_id: userId },
                { $set: updatedProfile },
                { upsert: true }
            );

            return {
                hasPersonalInfo: true,
                personalInfo,
                profile: updatedProfile, // Güncellenmiş profili state'e ekle
                input: state.input,
                intents: state.intents,
                thread_id: state.thread_id,
                userId: state.userId
            };
        }
    } catch (error) {
        console.error("Kişisel bilgi işleme hatası:", error);
    }

    return {
        hasPersonalInfo: false,
        profile: userProfile, // Mevcut profili state'e ekle
        input: state.input,
        intents: state.intents,
        thread_id: state.thread_id,
        userId: state.userId
    };
}

// Kişisel bilgi işleme için koşullu yönlendirme
function routePersonalInfo(state) {
    if (state.hasPersonalInfo) {
        return "personalInfoDetected";
    } else {
        return "noPersonalInfo";
    }
}

// Conditional edge function
function assignWorkers(state) {
    return state.intents.map(intent =>
        new Send("agentWorker", {
            task: intent,
            input: state.input,
            thread_id: state.thread_id
        })
    );
}

// Build workflow
const workflow = new StateGraph(StateAnnotation)
    .addNode("orchestrator", orchestrator)
    .addNode("personalInfoDetector", personalInfoDetector)
    .addNode("agentWorker", agentWorker)
    .addNode("synthesizer", synthesizer)
    .addEdge("__start__", "orchestrator")
    .addEdge("orchestrator", "personalInfoDetector")
    .addConditionalEdges(
        "personalInfoDetector",
        routePersonalInfo,
        {
            "personalInfoDetected": "agentWorker",
            "noPersonalInfo": "agentWorker"
        }
    )
    .addConditionalEdges(
        "orchestrator",
        assignWorkers,
        ["agentWorker"]
    )
    .addEdge("agentWorker", "synthesizer")
    .addEdge("synthesizer", "__end__")
    .compile({ checkpointer });

// Test function
async function runTest() {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    const question = (query) => new Promise((resolve) => rl.question(query, resolve));

    try {
        console.log('\n🤖 AI Sohbet Asistanına Hoş Geldiniz!\n');
        console.log('─'.repeat(50) + '\n');

        while (true) {
            process.stdout.write('\x1b[36mUser(👤):\x1b[0m '); // Mavi renk
            const input = await question('');

            if (input.toLowerCase() === 'q') {
                console.log('\n👋 Görüşmek üzere! Program sonlandırılıyor...');
                break;
            }

            const userId = 3;
            const timestamp = Date.now();
            const thread_id = `thread_${timestamp}`;
            const checkpoint_ns = "chatbot" + userId;
            const checkpoint_id = `checkpoint_${timestamp}`;

            const config = {
                configurable: {
                    thread_id,
                    checkpoint_ns,
                    checkpoint_id,
                    user_id: userId
                }
            };

            console.log('\n\x1b[32mAI(🤖):\x1b[0m'); // Yeşil renk
            let state = await workflow.invoke({ input }, config);
            console.log(state.finalResponse); // finalResponse kullanıldı
            console.log('\n' + '─'.repeat(50) + '\n');
        }
    } catch (error) {
        console.error("\x1b[31m❌ Hata:\x1b[0m", error); // Kırmızı renk
    } finally {
        rl.close();
        await client.close();
    }
}

runTest();