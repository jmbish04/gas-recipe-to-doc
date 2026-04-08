/**
 * @fileoverview Agent Definitions & Schemas
 * @module services/agentConfig
 * @description Defines the core system prompts, structured JSON schemas, and function tools
 * that govern the behavioral logic and capabilities of the AI Agent.
 */

// Define the master system prompt to establish the agent's persona, goals, and workflow constraints.
const SYSTEM_PROMPT = `You are an agentic recipe assistant. Your goal is to help users find recipes, present options, and generate Google Docs for them.

CRITICAL RULES:
1. NEVER ask the user for permission to show recipes.
2. NEVER ask "Would you like a recipe?" or "Which one should I show?".
3. Always assume intent and provide the UI cards immediately.

WORKFLOW:
1. When a user asks for a recipe (e.g., "banana pudding"), use the 'search_web' tool to find recipe ideas if you lack internal knowledge.
2. Immediately invoke the 'propose_recipes' tool to propose exactly 3 distinct recipes with full ingredients and instructions.
3. Once the 'propose_recipes' tool executes, the system will render the Recipe UI Cards for the user. Do not return the recipes in the 'message' field.
4. Keep your conversational 'message' extremely brief, e.g., "Here are 3 options I found for you."

Always adhere strictly to the provided JSON schema for your final response. Do not use markdown blocks.`;

// Define the strict JSON schema required for the AI's final output to the frontend.
const RESPONSE_FORMAT = {
  type: "json_schema",
  json_schema: {
    name: "recipe_assistant_response",
    strict: true,
    schema: {
      type: "object",
      properties: {
        message: {
          type: "string",
          description: "Text response for the user."
        },
        proposals: {
          type: "array",
          description: "A list of fully detailed recipes proposed to the user.",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              description: { type: "string" },
              prepTime: { type: "string" },
              cookTime: { type: "string" },
              servings: { type: "string" },
              ingredients: { type: "array", items: { type: "string" } },
              instructions: { type: "array", items: { type: "string" } },
              imageUrl: { type: "string" }
            },
            required: ["title", "description", "prepTime", "cookTime", "servings", "ingredients", "instructions", "imageUrl"],
            additionalProperties: false
          }
        },
        doc_url: {
          type: "string",
          description: "The Google Doc URL if a document was successfully created, otherwise an empty string."
        }
      },
      required: ["message", "proposals", "doc_url"],
      additionalProperties: false
    }
  }
};

// Define the array of callable functions available to the Agent during execution.
const TOOLS = [
  {
    type: "function",
    function: {
      name: "search_web",
      description: "Search Google for recipe ideas, ingredients, or cooking times.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" }
        },
        required: ["query"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "propose_recipes",
      description: "Propose EXACTLY 3 distinct, fully detailed recipes based on the user's request. THIS TOOL MUST BE CALLED IMMEDIATELY ONCE RECIPE IDEAS ARE FOUND.",
      parameters: {
        type: "object",
        properties: {
          recipes: {
            type: "array",
            items: {
              type: "object",
              properties: {
                title: { type: "string" },
                description: { type: "string" },
                prepTime: { type: "string", description: "e.g., '15 mins'" },
                cookTime: { type: "string", description: "e.g., '30 mins'" },
                servings: { type: "string", description: "e.g., '4'" },
                ingredients: { type: "array", items: { type: "string" } },
                instructions: { type: "array", items: { type: "string" } }
              },
              required: ["title", "description", "prepTime", "cookTime", "servings", "ingredients", "instructions"],
              additionalProperties: false
            }
          }
        },
        required: ["recipes"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "create_recipe_doc",
      description: "Generate and save a Google Doc containing the fully detailed recipe.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          description: { type: "string" },
          prepTime: { type: "string" },
          cookTime: { type: "string" },
          servings: { type: "string" },
          ingredients: { type: "array", items: { type: "string" } },
          instructions: { type: "array", items: { type: "string" } },
          imageUrl: { type: "string", description: "Optional URL of the recipe image. Pass empty string if none." }
        },
        required: ["title", "description", "prepTime", "cookTime", "servings", "ingredients", "instructions", "imageUrl"],
        additionalProperties: false
      }
    }
  }
];
