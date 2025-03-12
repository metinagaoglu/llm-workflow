const cheerio = require("cheerio");
const { CheerioWebBaseLoader } = require("@langchain/community/document_loaders/web/cheerio");
const { Document } = require("@langchain/core/documents");
const { ChatPromptTemplate } = require("@langchain/core/prompts");
const { pull } = require("langchain/hub");
const { Annotation, StateGraph } = require("@langchain/langgraph");
const { RecursiveCharacterTextSplitter } = require("@langchain/textsplitters");
const { MemoryVectorStore } = require("langchain/vectorstores/memory");
const { OpenAIEmbeddings } = require("@langchain/openai");
const dotenv = require("dotenv");
const { ChatOpenAI } = require("@langchain/openai");


// Load and chunk contents of blog
const pTagSelector = "p";
const cheerioLoader = new CheerioWebBaseLoader(
    //"https://www.devdungeon.com/content/packet-capture-injection-and-analysis-gopacket#google_vignette",
    "https://www.infobip.com/developers/blog/seniors-working-on-a-legacy-project",
    {
        selector: pTagSelector
    }
);

dotenv.config();


async function main() {

    const llm = new ChatOpenAI({
        openAIApiKey: process.env.OPENAI_API_KEY,
        modelName: "gpt-4",
        temperature: 0.0,
    });


    const embeddings = new OpenAIEmbeddings({
        model: "text-embedding-3-large",
        apiKey: process.env.OPENAI_API_KEY,
    });

    const docs = await cheerioLoader.load();

    const splitter = new RecursiveCharacterTextSplitter({
        chunkSize: 1000, chunkOverlap: 200
    });
    const allSplits = await splitter.splitDocuments(docs);

    const vectorStore = new MemoryVectorStore(embeddings);
    // Index chunks
    await vectorStore.addDocuments(allSplits)

    // Define prompt for question-answering
    const promptTemplate = await pull("rlm/rag-prompt");

    // Define state for application
    const InputStateAnnotation = Annotation.Root({
        question: Annotation
    });

    const StateAnnotation = Annotation.Root({
        question: Annotation,
        context: Annotation,
        answer: Annotation
    });

    // Define application steps
    const retrieve = async (state) => {
        const retrievedDocs = await vectorStore.similaritySearch(state.question)
        return { context: retrievedDocs };
    };


    const generate = async (state) => {
        const docsContent = state.context.map(doc => doc.pageContent).join("\n");
        const messages = await promptTemplate.invoke({ question: state.question, context: docsContent });
        const response = await llm.invoke(messages);
        return { answer: response.content };
    };


    // Compile application and test
    const graph = new StateGraph(StateAnnotation)
        .addNode("retrieve", retrieve)
        .addNode("generate", generate)
        .addEdge("__start__", "retrieve")
        .addEdge("retrieve", "generate")
        .addEdge("generate", "__end__")
        .compile();

    let inputs = { question: "Please give me a summary of the article" };

    const result = await graph.invoke(inputs);
    console.log(result.answer);
}

main();