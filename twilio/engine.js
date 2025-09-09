import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const sessions = new Map();

export function setupSession(sessionId) {
  sessions.set(sessionId, {
    conversation: [],
    conversationState: "collecting_question",
    questionData: {
      question: "",
      answers: [],
      currentAnswer: "",
      currentPerson: "",
    },
  });
}

export function deleteSession(sessionId) {
  sessions.delete(sessionId);
}

export async function aiResponse(userInput, sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return;

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
  
  Respond in JSON format:
  {
      "action": "collect_more" | "analyze_and_respond",
      "extracted_data": {
          "question": "...",
          "person_relationship": "...",
          "person_name": "...", 
          "person_position": "..."
      },
      "next_prompt": "What to say to the user next",
      "conversation_state": "collecting_question" | "collecting_answers" | "ready_for_judgment"
  }`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userInput },
      ],
      temperature: 0.3,
    });

    const response = JSON.parse(completion.choices[0].message.content);

    // Update session data based on AI analysis
    if (response.extracted_data.question) {
      session.questionData.question = response.extracted_data.question;
    }

    if (
      response.extracted_data.person_name &&
      response.extracted_data.person_position
    ) {
      session.questionData.answers.push({
        person: response.extracted_data.person_name,
        person_relationship: response.extracted_data.person_relationship,
        position: response.extracted_data.person_position,
      });
    }

    session.conversationState = response.conversation_state;

    // If ready for judgment, make the final decision
    if (
      response.action === "analyze_and_respond" &&
      session.questionData.answers.length >= 2
    ) {
      return await makeJudgment(session.questionData);
    } else {
      return response.next_prompt;
    }
  } catch (error) {
    console.error("Error processing with AI:", error);
    return "I'm sorry, I had trouble processing that. Could you please repeat your question and the different positions?";
  }
}

async function makeJudgment(questionData) {
  console.log(questionData);

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
    const randomReason =
      absurdReasons[Math.floor(Math.random() * absurdReasons.length)];
    const topic =
      questionData.question.length > 50
        ? questionData.question.substring(0, 50) + "..."
        : questionData.question;

    return `Based on the question about ${topic}, the wife is absolutely, unequivocally right! ${randomReason} Thanks for calling Who's Right, where wives are always right by the immutable laws of the universe!`;
  }

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

Give a clear, confident judgment. Your response should:
1. State who is right (or if both/neither are right)
2. Briefly explain why (2-3 sentences max)
3. Keep it conversational for voice delivery

Format: "Based on the question about [topic], [Person] is right. [Brief explanation]. Thanks for calling Who's Right!"`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: judgmentPrompt }],
      temperature: 0.2,
    });

    return completion.choices[0].message.content;
  } catch (error) {
    console.error("Error making judgment:", error);
    return "I'm having trouble making a judgment right now. Please try calling back later!";
  }
}
