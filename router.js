const { ChatOpenAI } = require("@langchain/openai");
const { HumanMessage, SystemMessage } = require("@langchain/core/messages");
const { StateGraph, Annotation } = require("@langchain/langgraph");
const { z } = require("zod");
const dotenv = require("dotenv");

dotenv.config();

const llm = new ChatOpenAI({
    openAIApiKey: process.env.OPENAI_API_KEY,
    modelName: "gpt-4",
    temperature: 0.0,
});

// Intent router için schema tanımla
const routeSchema = z.object({
    intent: z.enum(["search_number", "add_spam", "label_search", "start_chat", "count_contacts", "unknown"])
        .describe("The next step in the routing process"),
});


const router = llm.withStructuredOutput(routeSchema);

// Graph state tanımla
const StateAnnotation = Annotation.Root({
    input: Annotation,
    intent: Annotation,
    output: Annotation,
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
            "Append this to the beginning of the list based on users language:'Here are the labels for the number you searched for:'" +
            "User country is ID"
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
            content: `You are an intent detection agent. Route the input to match the following intents:
            - search_number
            - add_spam
            - label_search
            - start_chat
            - count_contacts
            - unknown
            
            You can return more than one intent.
            `
        },
        {
            role: "user",
            content: state.input
        },
    ]);

    return { intent: decision.intent };
}

async function addSpamAgent(state) {
    return { output: `AddSpam processing: ${state.input}` };
}

// Yönlendirme fonksiyonu
function routeDecision(state) {
    switch (state.intent) {
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
            console.log("unknown");
            return "unknown";
    }
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
    .addNode("countContactsAgent", countContactsAgent)
    .addNode("intentRouter", intentRouter)
    .addEdge("__start__", "intentRouter")
    .addConditionalEdges(
        "intentRouter",
        routeDecision,
        ["searchNumberAgent", "labelSearchAgent", "startChatAgent", "countContactsAgent"]
    )
    .addEdge("searchNumberAgent", "__end__")
    .addEdge("labelSearchAgent", "__end__")
    .addEdge("startChatAgent", "__end__")
    .addEdge("countContactsAgent", "__end__")
    .compile();

// Test fonksiyonu
async function runTest() {
    try {
        const testInputs = [
            "34343 numarasının etiketlerini görüp spam olarak işaretleyebilir miyim?",
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