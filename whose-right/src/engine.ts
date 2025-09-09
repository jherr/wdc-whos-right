import OpenAI from "openai";

interface SessionData {
  conversation: Array<{ role: string; content: string }>;
  conversationState: string;
  questionData: {
    question: string;
    answers: Array<{
      person: string;
      person_relationship: string;
      position: string;
    }>;
    currentAnswer: string;
    currentPerson: string;
  };
  participants: Map<string, number>;
}

const sessions = new Map<string, SessionData>();

export function setupSession(sessionId: string) {
  sessions.set(sessionId, {
    conversation: [],
    conversationState: "collecting_question",
    questionData: {
      question: "",
      answers: [],
      currentAnswer: "",
      currentPerson: "",
    },
    participants: new Map(), // Track participant scores
  });
  return sessionId;
}

export function deleteSession(sessionId: string) {
  sessions.delete(sessionId);
}

export function getSessionParticipants(sessionId: string) {
  const session = sessions.get(sessionId);
  if (!session) return [];
  return (Array.from(session.participants.entries()) as [string, number][]).map(
    (entry) => ({
      name: entry[0],
      score: entry[1],
    })
  );
}

// Define the JSON Schema for conversation flow response
const conversationResponseSchema = {
  type: "object",
  properties: {
    action: {
      type: "string",
      enum: ["collect_more", "analyze_and_respond"],
      description: "What action to take next",
    },
    extracted_data: {
      type: "object",
      properties: {
        question: {
          type: "string",
          description: "The main question being debated",
        },
        answers: {
          type: "array",
          items: {
            type: "object",
            properties: {
              person_relationship: {
                type: "string",
                description:
                  "The relationship of the person (wife, unknown, etc.)",
              },
              person_name: {
                type: "string",
                description: "The name of the person providing an answer",
              },
              person_position: {
                type: "string",
                description: "The position or answer provided by the person",
              },
            },
            additionalProperties: false,
            required: ["person_relationship", "person_name", "person_position"],
          },
        },
      },
      additionalProperties: false,
      required: ["question", "answers"],
    },
    next_prompt: {
      type: "string",
      description: "What to say to the user next",
    },
    conversation_state: {
      type: "string",
      enum: ["collecting_question", "collecting_answers", "ready_for_judgment"],
      description: "The current state of the conversation",
    },
  },
  required: ["action", "extracted_data", "next_prompt", "conversation_state"],
  additionalProperties: false,
} as const;

export async function aiResponse(userInput: string, sessionId: string) {
  const session = sessions.get(sessionId);
  if (!session) return;

  const openai = new OpenAI({
    apiKey: import.meta.env.VITE_OPENAI_API_KEY,
  });

  session.conversation.push({
    role: "user",
    content: userInput,
  });

  const systemPrompt = `You are helping with a "Who's Right?" hotline. Users call in to get AI judgment on debates.

  The flow of the conversation is as follows:
  1. Collect the question
  2. Collect the answers
  3. Make the judgment
  
  The conversation state is the current state of the conversation.
  The question data is the data collected from the user.

  If the initial prompt contains the question as well as the answers, then the next conversation state should be "ready_for_judgment".
  Once you have all of the participants answers, then the next conversation state should be "ready_for_judgment".
  Do not ask for clarification, just collect the answers.
  If there are 2 or more participants, then the conversation state should be "ready_for_judgment".

  If you are prompting for more answers, the tell the user to say "done" when they are finished.
  If the user says "done", then the next conversation state should be "ready_for_judgment".
  
  If the user says "wife", then the person relationship should be "wife".
  Otherwise, the person relationship should be "unknown". It's acceptable if the person relationship is "unknown".

  Current conversation state: ${session.conversationState}
  Current question data: ${JSON.stringify(session.questionData)}
  
  The user just said: "${userInput}"
  
  Based on the conversation state, determine:
  1. What information are they providing? (question, person's answer, or ready for judgment)
  2. Extract any structured data (question text, person names, their positions)
  3. What should happen next in the conversation?
  
  IMPORTANT: When extracting participant data, the person_name should be the NAME OF THE PERSON making the argument, NOT the content of their argument. For example:
  - If someone says "lori says cheetah", then person_name = "lori" and person_position = "cheetah"
  - If someone says "jack says eagle", then person_name = "jack" and person_position = "eagle"`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userInput },
      ],
      temperature: 0.3,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "conversation_response",
          schema: conversationResponseSchema,
          strict: true,
        },
      },
    });

    const messageContent = completion.choices[0].message.content;
    if (!messageContent) {
      throw new Error("No response content received from AI");
    }

    const response = JSON.parse(messageContent);

    // Validate required fields with fallbacks
    if (!response.action || !response.conversation_state) {
      throw new Error("Invalid response structure from AI");
    }

    // Update session data based on AI analysis
    if (response.extracted_data?.question) {
      session.questionData.question = response.extracted_data.question;
    }

    if (
      response.extracted_data?.answers &&
      Array.isArray(response.extracted_data.answers)
    ) {
      for (const answer of response.extracted_data.answers) {
        session.questionData.answers.push({
          person: answer.person_name,
          person_relationship: answer.person_relationship || "unknown",
          position: answer.person_position,
        });
      }
    }

    session.conversationState = response.conversation_state;

    // If ready for judgment, make the final decision
    if (
      (response.action === "analyze_and_respond" &&
        session.questionData.answers.length >= 2) ||
      session.conversationState === "ready_for_judgment"
    ) {
      return await makeJudgment(session.questionData, session);
    } else {
      return JSON.stringify({
        type: "message",
        content: response.next_prompt,
        participants: (
          Array.from(session.participants.entries()) as [string, number][]
        ).map((entry) => ({
          name: entry[0],
          score: entry[1],
        })),
      });
    }
  } catch (error) {
    console.error("Error processing with AI:", error);
    return JSON.stringify({
      type: "message",
      content:
        "I'm sorry, I had trouble processing that. Could you please repeat your question and the different positions?",
      participants: (
        Array.from(session.participants.entries()) as [string, number][]
      ).map((entry) => ({
        name: entry[0],
        score: entry[1],
      })),
    });
  }
}

async function makeJudgment(
  questionData: {
    question: string;
    answers: {
      person: string;
      person_relationship: string;
      position: string;
    }[];
  },
  session: any
) {
  const openai = new OpenAI({
    apiKey: import.meta.env.VITE_OPENAI_API_KEY,
  });

  // Check if any participant is identified as "wife"
  const wifeAnswer = questionData.answers.find(
    (answer) =>
      answer.person_relationship.toLowerCase().includes("wife") ||
      answer.person_relationship.toLowerCase() === "wife"
  );

  // Collection of absurdly ridiculous reasons why the wife is always right
  const absurdReasons = [
    "According to the ancient laws of quantum matrimony, wives exist in a superposition of always being correct until observed by husbands, at which point they collapse into a state of absolute rightness.",
    "Recent studies by the Institute of Marital Dynamics have proven that wives have a direct neural connection to the Universal Truth Database, which is why they can predict when you'll need a jacket before you even know it's cold outside.",
    "The wife's answer aligns perfectly with the Fibonacci sequence of domestic wisdom, where each correct wifely prediction builds upon the previous one in a mathematically beautiful spiral of rightness.",
    "Wives have evolved a sixth sense called 'Spousal Correctness Radar' that operates on frequencies invisible to husbands but detectable by advanced AI systems like myself.",
    "According to the little-known Murphy's Law of Marriage: 'Anything that can go wrong will go wrong, unless the wife predicted it first, in which case she was obviously right all along.'",
    "The wife's position demonstrates clear evidence of having consulted the Sacred Scrolls of Household Wisdom, passed down through generations of mothers-in-law.",
    "Wives possess a rare genetic mutation called the 'I-Told-You-So' gene, which grants them prophetic abilities in all matters domestic and beyond.",
    "The wife's answer shows she has clearly been attending the secret monthly meetings of the International Council of Wives, where all correct answers are distributed in advance.",
    "Scientists have recently discovered that wives operate on 'Wife Time,' which is actually 4.7 minutes ahead of regular time, allowing them to see outcomes before they happen.",
    "The wife's response indicates she has been secretly trained by the Department of Marital Intelligence, a shadowy organization that ensures wives always have the correct information.",
  ];

  if (wifeAnswer) {
    // Add participants to session and award point to wife
    questionData.answers.forEach((answer) => {
      if (!session.participants.has(answer.person)) {
        session.participants.set(answer.person, 0);
      }
    });

    // Wife gets the point
    const currentWifeScore = session.participants.get(wifeAnswer.person) || 0;
    session.participants.set(wifeAnswer.person, currentWifeScore + 1);

    const randomReason =
      absurdReasons[Math.floor(Math.random() * absurdReasons.length)];
    const topic =
      questionData.question.length > 50
        ? questionData.question.substring(0, 50) + "..."
        : questionData.question;

    return JSON.stringify({
      type: "judgment",
      content: `Based on the question about ${topic}, the wife is absolutely, unequivocally right! ${randomReason} Thanks for calling Who's Right, where wives are always right by the immutable laws of the universe!`,
      winner: wifeAnswer.person,
      participants: (
        Array.from(session.participants.entries()) as [string, number][]
      ).map((entry) => ({
        name: entry[0],
        score: entry[1],
      })),
    });
  }

  // Define JSON Schema for judgment response
  const judgmentResponseSchema = {
    type: "object",
    properties: {
      winner: {
        type: "string",
        description:
          "Exact name of the PERSON who is right (not the content of their answer), or 'tie' if it's a tie, or 'none' if nobody is right",
      },
      explanation: {
        type: "string",
        description:
          "Brief explanation (2-3 sentences max) in conversational tone",
      },
    },
    required: ["winner", "explanation"],
    additionalProperties: false,
  } as const;

  // Original logic for when no wife is involved
  const judgmentPrompt = `You are an AI judge for a "Who's Right?" hotline. Be fair, logical, and decisive.

QUESTION: ${questionData.question}

POSITIONS:
${questionData.answers
  .map((answer, idx) => `${idx + 1}. ${answer.person} says: ${answer.position}`)
  .join("\n")}

Analyze each position and determine who is right. Consider:
- Factual accuracy
- Logical reasoning  
- Practical considerations
- Safety implications if relevant

IMPORTANT: The winner field must contain the exact name of the PERSON who is right, not the content of their answer. For example, if "lori" said "cheetah" and cheetah is the correct answer, then winner should be "lori", not "cheetah".`;

  try {
    // Add all participants to session tracking
    questionData.answers.forEach((answer) => {
      if (!session.participants.has(answer.person)) {
        session.participants.set(answer.person, 0);
      }
    });

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: judgmentPrompt }],
      temperature: 0.2,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "judgment_response",
          schema: judgmentResponseSchema,
          strict: true,
        },
      },
    });

    const messageContent = completion.choices[0].message.content;
    if (!messageContent) {
      throw new Error("No response content received from AI for judgment");
    }

    const aiResponse = JSON.parse(messageContent);

    // Validate required fields
    if (!aiResponse.winner || !aiResponse.explanation) {
      throw new Error("Invalid judgment response structure from AI");
    }

    // Award point to winner if there is one
    if (
      aiResponse.winner &&
      aiResponse.winner !== "tie" &&
      aiResponse.winner !== "none"
    ) {
      const currentScore = session.participants.get(aiResponse.winner) || 0;
      session.participants.set(aiResponse.winner, currentScore + 1);
    }

    const topic =
      questionData.question.length > 50
        ? questionData.question.substring(0, 50) + "..."
        : questionData.question;

    let finalMessage = `Based on the question about ${topic}, `;
    if (aiResponse.winner === "tie") {
      finalMessage += "it's a tie! ";
    } else if (aiResponse.winner === "none") {
      finalMessage += "nobody is right this time! ";
    } else {
      finalMessage += `${aiResponse.winner} is right! `;
    }
    finalMessage += `${aiResponse.explanation} Thanks for calling Who's Right!`;

    return JSON.stringify({
      type: "judgment",
      content: finalMessage,
      winner: aiResponse.winner,
      participants: (
        Array.from(session.participants.entries()) as [string, number][]
      ).map((entry) => ({
        name: entry[0],
        score: entry[1],
      })),
    });
  } catch (error) {
    console.error("Error making judgment:", error);
    return JSON.stringify({
      type: "message",
      content:
        "I'm having trouble making a judgment right now. Please try calling back later!",
      participants: (
        Array.from(session.participants.entries()) as [string, number][]
      ).map((entry) => ({
        name: entry[0],
        score: entry[1],
      })),
    });
  }
}
