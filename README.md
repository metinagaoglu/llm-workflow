# AI Chatbot Sample with LangGraph

A sophisticated chatbot system built with LangGraph, featuring intent detection, personal information handling, and multi-agent workflow orchestration.

## Features

- 🤖 Multi-intent detection and handling
- 🔒 Personal information detection and secure storage
- 📝 Conversation history tracking
- 🔄 State management with MongoDB checkpointing
- 📊 Performance monitoring with Langfuse
- 🌐 Multi-language support

## Prerequisites

- Node.js (v14 or higher)
- Docker and Docker Compose
- MongoDB
- OpenAI API Key

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd <project-directory>
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file in the root directory:
```env
OPENAI_API_KEY=your_openai_api_key
MONGODB_URI=mongodb://root:example@localhost:27027
INTERNAL_API_URL=http://your-internal-api-url
```

4. Start the required services:
```bash
docker-compose up -d
```

## Project Structure

The project consists of several key components:

- **Intent Detection**: Analyzes user input to determine the intended action
- **Personal Info Detection**: Identifies and securely handles personal information
- **Multi-Agent System**: Orchestrates different specialized agents for various tasks
- **State Management**: Maintains conversation state and history using MongoDB

## Usage

To start the chatbot:

```bash
node semantic.js
```

The system supports various commands:
- Search number information
- Label search
- Contact counting
- Spam marking
- General chat interactions

## Docker Services

The project includes several Docker services (reference to docker-compose.yml):
```yaml:docker-compose.yml
startLine: 1
endLine: 37
```

## Monitoring

The project includes Langfuse integration for monitoring and analytics:
```javascript:semantic.js
startLine: 9
endLine: 16
```

## Acknowledgments

- LangGraph for the workflow orchestration framework
- OpenAI for the language models
- MongoDB for state management
- Langfuse for monitoring capabilities
