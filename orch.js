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

// Nodes
async function orchestrator(state) {
    const userId = state.config?.user_id;

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
        thread_id: state.config?.thread_id
    };
}
/*
async function orchestrator(state) {
    console.log("Thread ID in orchestrator:", state.config);

    // Get chat history from MongoDB
    const history = await client
        .db(dbName)
        .collection("chatHistory")
        .find({ thread_id: state.config?.thread_id })
        .sort({ timestamp: -1 })
        .limit(5)  // Son 5 mesajı al
        .toArray();

    // Format history for LLM context
    const formattedHistory = history.map(msg => ({
        role: msg.role,
        content: msg.content
    }));

    console.log(formattedHistory);

    const decision = await router.invoke([
        {
            role: "system",
            content: `You are an intent detection agent. Analyze the input and return ALL matching intents from:
            - search_number: When user wants to search for a number
            - add_spam: When user wants to mark a number as spam
            - label_search: When user wants to see labels for a number
            - count_contacts: When user wants to count contacts
            - unknown: When intent is not clear

            Return all relevant intents.`
        },
        { role: "user", content: state.input }
    ]);

    // Save the new message to history
    await client
        .db(dbName)
        .collection("chatHistory")
        .insertOne({
            thread_id: state.config?.thread_id,
            role: "user",
            content: state.input,
            timestamp: new Date()
        });

    return {
        intents: decision.intents,
        input: state.input,
        thread_id: state.config?.thread_id
    };
}
*/

// Mock handler functions
async function handleSearchNumber(input) {
    return "Bu numara hakkında bilgi bulunamadı.";
}

async function handleChatBot(input) {
    const result = await llm.invoke([
        {
            role: "system",
            content: "Sen yardımcı bir asistansın. Türkçe olarak cevap ver. Nazik ve yardımsever ol."
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
    console.log(state)
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
            result = { content: await handleChatBot(state.input) }
            break;
        default:
            result = { content: await handleChatBot(state.input) }; // chatbot
    }

    return { completedTasks: [`${state.task}: ${result.content}`] };
}

async function synthesizer(state) {
    //console.log("Thread ID in synthesizer:", state.config?.thread_id);
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
    .addNode("agentWorker", agentWorker)
    .addNode("synthesizer", synthesizer)
    .addEdge("__start__", "orchestrator")
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
        while (true) {
            const input = await question('\nSorunuzu yazın (Çıkmak için "q" yazın): ');

            if (input.toLowerCase() === 'q') {
                console.log('Program sonlandırılıyor...');
                break;
            }

            const userId = 3;

            const timestamp = 'same';
            const thread_id = `thread_${timestamp}`;
            const checkpoint_ns = "chatbot" + userId; // Uygulamanıza uygun bir namespace değeri
            const checkpoint_id = `checkpoint_${timestamp}`;

            console.log(`\nGirdi: ${input}`);

            const config = {
                configurable: {
                    thread_id: thread_id,
                    checkpoint_ns: checkpoint_ns,
                    checkpoint_id: checkpoint_id,
                    user_id: "1"
                }
            };

            let state;

            state = await workflow.invoke({ input }, config);

            console.log(`Çıktı: ${state.finalResponse}`);
        }
    } catch (error) {
        console.error("Hata:", error);
    } finally {
        rl.close();
        await client.close();
    }
}

runTest();