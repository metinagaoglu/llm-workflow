const { ChatOpenAI } = require("@langchain/openai");
const { HumanMessage, SystemMessage } = require("@langchain/core/messages");
const { StateGraph, Annotation } = require("@langchain/langgraph");
const { z } = require("zod");
const dotenv = require("dotenv");

//sendBotMessage 

dotenv.config();

const llm = new ChatOpenAI({
    openAIApiKey: process.env.OPENAI_API_KEY,
    modelName: "gpt-4",
    temperature: 0.0,
});

// Intent router için schema tanımla
const routeSchema = z.object({
    intents: z.array(z.enum(["search_number", "add_spam", "label_search", "start_chat", "count_contacts", "unknown"]))
        .describe("The next step in the routing process"),
});

const router = llm.withStructuredOutput(routeSchema);

// Graph state tanımla
const StateAnnotation = Annotation.Root({
    input: Annotation,
    intents: Annotation,
    output: Annotation({
        default: () => [],
        reducer: (a, b) => a.concat(b),
    }),
});

// Agent node'ları
async function searchNumberAgent(state) {
    return { output: `SearchNumber processing: ${state.input}` };
    const result = await llm.invoke([{
        role: "system",
        content: "You are a number search specialist.",
    }, {
        role: "user",
        content: state.input
    }]);
    return { output: `SearchNumber processing: ${result.content}` };
}

async function labelSearchAgent(state) {
    const internalAPI = require('./services/internalAPI');
    let res;
    try {
        res = await internalAPI.searchLabels(state)
    } catch (error) {
        // Premium olmayabilir
        // Down olabilir ?
        return { output: `LabelSearch processing: ${error.message}` };
    }
    //return { output: `LabelSearch processing: ${state.input}` };
    const result = await llm.invoke([{
        role: "system",
        content: "You are responsible for formatting the labels. You will be given a list of labels and you will need to format them into a readable format." +
            "Append this to the beginning of the list based on users language:'Here are the labels for the number you searched for:'"
    }, {
        role: "user",
        content: JSON.stringify(res)
    }]);
    return { output: result.content };
}

async function startChatAgent(state) {
    return { output: `StartChat processing: ${state.input}` };
    const result = await llm.invoke([{
        role: "system",
        content: "You are a chat initiation specialist.",
    }, {
        role: "user",
        content: state.input
    }]);
    return { output: `StartChat processing: ${result.content}` };
}

async function countContactsAgent(state) {
    return { output: `CountContacts processing: ${state.input}` };
    const result = await llm.invoke([{
        role: "system",
        content: "You are a contact counting specialist.",
    }, {
        role: "user",
        content: state.input
    }]);
    return { output: `CountContacts processing: ${result.content}` };
}

// Router node
async function intentRouter(state) {
    const decision = await router.invoke([
        {
            role: "system",
            content: `You are an intent detection agent. Analyze the input and return ALL matching intents from the following list:
            - search_number: When user wants to search for a number
            - add_spam: When user wants to mark something as spam
            - label_search: When user wants to see labels for a number
            - start_chat: When user wants to start a chat
            - count_contacts: When user wants to count contacts
            - unknown: When no other intent matches

            Return ALL relevant intents. For example, if user wants to search a number and mark it as spam,
            return both intents
            `
        },
        {
            role: "user",
            content: state.input
        },
    ]);

    return { intents: decision.intents };
}

async function addSpamAgent(state) {
    return { output: `AddSpam processing: ${state.input}` };
}

// Output formatter agent'ı ekle
async function outputFormatterAgent(state) {

    // Agent1 -> Agent2

    // Eğer tek bir çıktı varsa direkt döndür
    if (!Array.isArray(state.output)) {
        return { output: state.output };
    }

    const result = await llm.invoke([
        {
            role: "system",
            content: `You are an output formatter. You will receive multiple outputs from different processes.
            Combine and format them into a coherent response. Make sure to:
            1. Remove any redundant information
            2. Present the information in a clear, organized manner
            3. If the output contains both search results and spam reports, organize them logically
            4. Make sure that the output must be single sentence
            5. Users language is TR`
        },
        {
            role: "user",
            content: `Please format these outputs into a coherent response: ${JSON.stringify(state.output)}`
        }
    ]);



    return { output: result.content };
}

// Fan-out
function routeDecision(state) {
    // Tüm intentleri işleyecek node'ları döndür
    return state.intents.map(intent => {
        switch (intent) {
            case "search_number":
                return "searchNumberAgent";
            case "add_spam":
                return "addSpamAgent";
            case "label_search":
                return "labelSearchAgent";
            case "start_chat":
                return "startChatAgent";
            case "count_contacts":
                return "countContactsAgent";
            default:
                return null;
        }
    }).filter(node => node !== null);
}

/**
 * Draw the workflow
 * 
 * intentRouter -> searchNumberAgent 
 * intentRouter -> labelSearchAgent -> Anaylze -> 2 etiketin öğretnmen 3 yazılım , 2 q 
 * intentRouter -> startChatAgent
 * intentRouter -> countContactsAgent
 * 
 */
const workflow = new StateGraph(StateAnnotation)
    .addNode("searchNumberAgent", searchNumberAgent)
    .addNode("labelSearchAgent", labelSearchAgent)
    .addNode("startChatAgent", startChatAgent)
    .addNode("addSpamAgent", addSpamAgent)
    .addNode("countContactsAgent", countContactsAgent)
    .addNode("intentRouter", intentRouter)
    .addNode("outputFormatter", outputFormatterAgent)
    .addEdge("__start__", "intentRouter")
    .addConditionalEdges(
        "intentRouter",
        routeDecision,
        ["searchNumberAgent", "labelSearchAgent", "addSpamAgent", "startChatAgent", "countContactsAgent"]
    )
    // Tüm agent'ları output formatter'a yönlendir
    .addEdge("searchNumberAgent", "outputFormatter")
    .addEdge("labelSearchAgent", "outputFormatter")
    .addEdge("startChatAgent", "outputFormatter")
    .addEdge("addSpamAgent", "outputFormatter")
    .addEdge("countContactsAgent", "outputFormatter")
    .addEdge("outputFormatter", "__end__")
    .compile();

// Test fonksiyonu
async function runTest() {
    try {
        const testInputs = [
            //"34343 numarasının etiketlerini görüp spam olarak işaretler misin?",
            "34343 numarasının skorunu görüp eğer düşük ise spam olarak işaretler misin?",
            //"How many people are in my contact list",
            //"can i start a chat with this number? 3232323", //EMIT: start_chat -> client ??
            //"Berapa banyak orang yang ada di daftar kontak saya di Getcontact?"
        ];

        for (const input of testInputs) {
            console.log(`Input: ${input}`);
            const state = await workflow.invoke({ input });
            console.log(`Output: ${state.output}\n`);
        }
    } catch (error) {
        console.error("Hata:", error);
    }
}

runTest();
