export interface GameSummary {
  id: string;
  title: string;
  type: "2d" | "3d";
  genre: string;
}

export type SessionMemory = {
  gamesBuiltThisSession: GameSummary[];
  userPreferences: {
    preferredGameType: "2d" | "3d" | null;
    preferredGenre: string | null;
    preferredComplexity: "simple" | "medium" | "complex" | null;
    styleKeywords: string[];
  };
  currentProjectContext: {
    engine: string;
    filesCreated: string[];
    packagesInstalled: string[];
    lastEditedFile: string | null;
  };
  conversationTone: "first-time" | "regular" | "power-user";
};

export function compressSessionMemory(memory: SessionMemory): string {
  const { gamesBuiltThisSession, userPreferences, currentProjectContext, conversationTone } = memory;
  
  let summary = `Context: `;
  
  if (gamesBuiltThisSession.length > 0) {
    summary += `User has built ${gamesBuiltThisSession.length} games today. `;
  }
  
  if (userPreferences.preferredGameType || userPreferences.styleKeywords.length > 0) {
    summary += `Seems to prefer ${userPreferences.preferredGameType?.toUpperCase() || 'any'}`;
    if (userPreferences.styleKeywords.length > 0) {
      summary += ` with ${userPreferences.styleKeywords.join(', ')} aesthetics. `;
    } else {
      summary += ` aesthetics. `;
    }
  }

  if (currentProjectContext.packagesInstalled.length > 0) {
    summary += `Current project has ${currentProjectContext.packagesInstalled.join(' + ')} installed. `;
  }

  if (currentProjectContext.lastEditedFile) {
    summary += `Last edited: ${currentProjectContext.lastEditedFile}. `;
  }

  summary += `Tone constraint: ${conversationTone}.`;

  return summary.trim();
}

// Represents Cross-Session history that would be fetched from D1
export interface UserCrossSessionHistory {
  totalGamesBuilt: number;
  mostlyBuilds: "2d" | "3d" | "mixed";
  commonPostGenRequests: string[];
  lastProjectTitle: string | null;
  lastVisitDate: string | null; // ISO Date
}

export function generateCrossSessionPrompt(history: UserCrossSessionHistory): string {
  if (history.totalGamesBuilt === 0) return "This is the user's first time building a game.";
  
  let prompt = `This user has built ${history.totalGamesBuilt} games. `;
  prompt += `Mostly ${history.mostlyBuilds.toUpperCase()}. `;
  
  if (history.commonPostGenRequests.length > 0) {
    prompt += `Tends to ask for ${history.commonPostGenRequests.join(', ')} after first generation. `;
  }
  
  if (history.lastProjectTitle) {
    prompt += `Last project: ${history.lastProjectTitle}.`;
  }
  
  return prompt.trim();
}

export function getSmartGreeting(history: UserCrossSessionHistory, isSameDay: boolean): string {
  if (history.totalGamesBuilt >= 10) {
    return "what are we building?";
  }
  
  if (history.totalGamesBuilt === 0) {
    return "describe a game. anything — I'll handle the code, physics, and setup.";
  }
  
  if (isSameDay && history.lastProjectTitle) {
    return `welcome back — continuing from ${history.lastProjectTitle}?`;
  }
  
  if (history.lastProjectTitle) {
    return `the ${history.lastProjectTitle} from yesterday is still here if you want to pick it up. or start something new?`;
  }

  return "ready to build something new?";
}
