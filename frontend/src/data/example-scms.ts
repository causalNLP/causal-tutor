import type { SCMSchema } from "@/types";

export interface SCMExampleMeta {
  id: string;
  name: string;
  description: string;
  concept: string;
  schema: SCMSchema;
}

const DEFAULT_CHAIN: SCMSchema = {
  id: "default-chain",
  name: "Simple 3-variable chain",
  variables: [
    {
      id: "x1",
      name: "X₁",
      dependencies: [],
      coefficients: {},
      intercept: 0,
      noise: { key: "n1", name: "N₁", distribution: { type: "normal", params: { mean: 0, std: 1 } } },
      noise_coefficient: 1,
    },
    {
      id: "x2",
      name: "X₂",
      dependencies: ["x1"],
      coefficients: { x1: 2.5 },
      intercept: 0,
      noise: { key: "n2", name: "N₂", distribution: { type: "normal", params: { mean: 0, std: 1 } } },
      noise_coefficient: 1,
    },
    {
      id: "x3",
      name: "X₃",
      dependencies: ["x1"],
      coefficients: { x1: -7.0 },
      intercept: 0,
      noise: { key: "n3", name: "N₃", distribution: { type: "normal", params: { mean: 0, std: 1 } } },
      noise_coefficient: 1,
    },
  ],
};

const MEDIATION_CHAIN: SCMSchema = {
  id: "mediation-chain",
  name: "Mediation Chain",
  variables: [
    {
      id: "x1",
      name: "X₁",
      dependencies: [],
      coefficients: {},
      intercept: 0,
      noise: { key: "n1", name: "N₁", distribution: { type: "normal", params: { mean: 0, std: 1 } } },
      noise_coefficient: 1,
    },
    {
      id: "x2",
      name: "X₂",
      dependencies: ["x1"],
      coefficients: { x1: 1.8 },
      intercept: 0,
      noise: { key: "n2", name: "N₂", distribution: { type: "normal", params: { mean: 0, std: 1 } } },
      noise_coefficient: 1,
    },
    {
      id: "x3",
      name: "X₃",
      dependencies: ["x2"],
      coefficients: { x2: -1.2 },
      intercept: 0,
      noise: { key: "n3", name: "N₃", distribution: { type: "normal", params: { mean: 0, std: 1 } } },
      noise_coefficient: 1,
    },
  ],
};

//  Spurious correlation via a common cause "ice cream causes drowning" example to show why correlation isn't causation.
// Hot weather drives both ice cream sales and swimming (hence drownings); ice cream sales and drownings correlate but neither causes the other.
const SPURIOUS_CORRELATION: SCMSchema = {
  id: "spurious-correlation",
  name: "Temperature, Ice Cream Sales & Drownings",
  variables: [
    {
      id: "temperature",
      name: "Temperature",
      dependencies: [],
      coefficients: {},
      intercept: 20,
      noise: { key: "n1", name: "N₁", distribution: { type: "normal", params: { mean: 0, std: 5 } } },
      noise_coefficient: 1,
    },
    {
      id: "ice_cream_sales",
      name: "Ice Cream Sales",
      dependencies: ["temperature"],
      coefficients: { temperature: 3.0 },
      intercept: 10,
      noise: { key: "n2", name: "N₂", distribution: { type: "normal", params: { mean: 0, std: 8 } } },
      noise_coefficient: 1,
    },
    {
      id: "drowning_incidents",
      name: "Drowning Incidents",
      dependencies: ["temperature"],
      coefficients: { temperature: 0.4 },
      intercept: -2,
      noise: { key: "n3", name: "N₃", distribution: { type: "normal", params: { mean: 0, std: 1.5 } } },
      noise_coefficient: 1,
    },
  ],
};

// chain --> full mediation: years of education raise skill level, and skill level is what employers pay for.
const EDUCATION_INCOME: SCMSchema = {
  id: "education-skill-income",
  name: "Education, Skill & Income",
  variables: [
    {
      id: "education_years",
      name: "Education (years)",
      dependencies: [],
      coefficients: {},
      intercept: 12,
      noise: { key: "n1", name: "N₁", distribution: { type: "normal", params: { mean: 0, std: 2 } } },
      noise_coefficient: 1,
    },
    {
      id: "skill_level",
      name: "Skill Level",
      dependencies: ["education_years"],
      coefficients: { education_years: 0.8 },
      intercept: 0,
      noise: { key: "n2", name: "N₂", distribution: { type: "normal", params: { mean: 0, std: 1 } } },
      noise_coefficient: 1,
    },
    {
      id: "income",
      name: "Income ($1000s)",
      dependencies: ["skill_level"],
      coefficients: { skill_level: 5.0 },
      intercept: 20,
      noise: { key: "n3", name: "N₃", distribution: { type: "normal", params: { mean: 0, std: 6 } } },
      noise_coefficient: 1,
    },
  ],
};

// confounded mediation: backdoor path alongside a causal chain -> smoking and cancer example case study in why
// randomized trials or careful backdoor adjustment matter. A genotype affects both the tendency to smoke and cancer risk directly,
// while smoking also has its own effect on cancer through tar buildup.
const SMOKING_CANCER: SCMSchema = {
  id: "smoking-tar-cancer-genotype",
  name: "Genetic Confounding",
  variables: [
    {
      id: "genotype",
      name: "Genotype",
      dependencies: [],
      coefficients: {},
      intercept: 0,
      noise: { key: "n1", name: "N₁", distribution: { type: "normal", params: { mean: 0, std: 1 } } },
      noise_coefficient: 1,
    },
    {
      id: "smoking",
      name: "Smoking (packs/day)",
      dependencies: ["genotype"],
      coefficients: { genotype: 0.5 },
      intercept: 1,
      noise: { key: "n2", name: "N₂", distribution: { type: "normal", params: { mean: 0, std: 0.5 } } },
      noise_coefficient: 1,
    },
    {
      id: "tar_deposit",
      name: "Tar Deposit",
      dependencies: ["smoking"],
      coefficients: { smoking: 4.0 },
      intercept: 0,
      noise: { key: "n3", name: "N₃", distribution: { type: "normal", params: { mean: 0, std: 1 } } },
      noise_coefficient: 1,
    },
    {
      id: "cancer_risk",
      name: "Cancer Risk",
      dependencies: ["tar_deposit", "genotype"],
      coefficients: { tar_deposit: 0.6, genotype: 1.2 },
      intercept: 0,
      noise: { key: "n4", name: "N₄", distribution: { type: "normal", params: { mean: 0, std: 1 } } },
      noise_coefficient: 1,
    },
  ],
};

// collider: selection bias / Berkson's paradox
// Talent and luck are independent causes that both feed into success. Conditioning on success (e.g. only looking at famous actors) induces a
// spurious negative association between talent and luck.
const TALENT_LUCK_SUCCESS: SCMSchema = {
  id: "talent-luck-success",
  name: "Talent or Luck?",
  variables: [
    {
      id: "talent",
      name: "Talent",
      dependencies: [],
      coefficients: {},
      intercept: 0,
      noise: { key: "n1", name: "N₁", distribution: { type: "normal", params: { mean: 0, std: 1 } } },
      noise_coefficient: 1,
    },
    {
      id: "luck",
      name: "Luck",
      dependencies: [],
      coefficients: {},
      intercept: 0,
      noise: { key: "n2", name: "N₂", distribution: { type: "normal", params: { mean: 0, std: 1 } } },
      noise_coefficient: 1,
    },
    {
      id: "success",
      name: "Success",
      dependencies: ["talent", "luck"],
      coefficients: { talent: 1.0, luck: 1.0 },
      intercept: 0,
      noise: { key: "n3", name: "N₃", distribution: { type: "normal", params: { mean: 0, std: 0.5 } } },
      noise_coefficient: 1,
    },
  ],
};

// diamond: two mediating paths recombining at a common effect
// exercise affects health both by lowering weight and by improving mood. weight and mood then jointly determine overall health outcome. 
const EXERCISE_HEALTH: SCMSchema = {
  id: "exercise-weight-mood-health",
  name: "Effect of Exercise on Health",
  variables: [
    {
      id: "exercise",
      name: "Exercise (hrs/week)",
      dependencies: [],
      coefficients: {},
      intercept: 3,
      noise: { key: "n1", name: "N₁", distribution: { type: "normal", params: { mean: 0, std: 1.5 } } },
      noise_coefficient: 1,
    },
    {
      id: "weight",
      name: "Body Weight (kg)",
      dependencies: ["exercise"],
      coefficients: { exercise: -1.5 },
      intercept: 80,
      noise: { key: "n2", name: "N₂", distribution: { type: "normal", params: { mean: 0, std: 4 } } },
      noise_coefficient: 1,
    },
    {
      id: "mood",
      name: "Mood Score",
      dependencies: ["exercise"],
      coefficients: { exercise: 0.9 },
      intercept: 5,
      noise: { key: "n3", name: "N₃", distribution: { type: "normal", params: { mean: 0, std: 1 } } },
      noise_coefficient: 1,
    },
    {
      id: "health",
      name: "Health Score",
      dependencies: ["weight", "mood"],
      coefficients: { weight: -0.3, mood: 2.0 },
      intercept: 50,
      noise: { key: "n4", name: "N₄", distribution: { type: "normal", params: { mean: 0, std: 3 } } },
      noise_coefficient: 1,
    },
  ],
};

const MIXED_NETWORK: SCMSchema = {
  id: "mlss-tutorial",
  name: "MLSS Tutorial",
  variables: [
    {
      id: "x1",
      name: "X₁",
      dependencies: [],
      coefficients: {},
      intercept: 0,
      noise: { key: "n1", name: "N₁", distribution: { type: "normal", params: { mean: 0, std: 1 } } },
      noise_coefficient: 1,
      position: { x: 0, y: 0 },
    },
    {
      id: "x2",
      name: "X₂",
      dependencies: ["x1", "x3"],
      coefficients: { x1: 1.0, x3: 1.0 },
      intercept: 0,
      noise: { key: "n2", name: "N₂", distribution: { type: "normal", params: { mean: 0, std: 1 } } },
      noise_coefficient: 1,
      position: { x: 135, y: 165 },
    },
    {
      id: "x3",
      name: "X₃",
      dependencies: [],
      coefficients: {},
      intercept: 0,
      noise: { key: "n3", name: "N₃", distribution: { type: "normal", params: { mean: 0, std: 1 } } },
      noise_coefficient: 1,
      position: { x: 260, y: 20 },
    },
    {
      id: "x4",
      name: "X₄",
      dependencies: ["x2"],
      coefficients: { x2: 1.0 },
      intercept: 0,
      noise: { key: "n4", name: "N₄", distribution: { type: "normal", params: { mean: 0, std: 1 } } },
      noise_coefficient: 1,
      position: { x: 135, y: 255 },
    },
    {
      id: "x5",
      name: "X₅",
      dependencies: ["x3", "x6"],
      coefficients: { x3: 1.0, x6: 1.0 },
      intercept: 0,
      noise: { key: "n5", name: "N₅", distribution: { type: "normal", params: { mean: 0, std: 1 } } },
      noise_coefficient: 1,
      position: { x: 255, y: 210 },
    },
    {
      id: "x6",
      name: "X₆",
      dependencies: ["x3"],
      coefficients: { x3: 1.0 },
      intercept: 0,
      noise: { key: "n6", name: "N₆", distribution: { type: "normal", params: { mean: 0, std: 1 } } },
      noise_coefficient: 1,
      position: { x: 350, y: 105 },
    },
    {
      id: "x7",
      name: "X₇",
      dependencies: ["x1", "x5"],
      coefficients: { x1: 1.0, x5: 1.0 },
      intercept: 0,
      noise: { key: "n7", name: "N₇", distribution: { type: "normal", params: { mean: 0, std: 1 } } },
      noise_coefficient: 1,
      position: { x: 115, y: 370 },
    },
  ],
};

export const SCM_EXAMPLES: SCMExampleMeta[] = [
  {
    id: MIXED_NETWORK.id,
    name: MIXED_NETWORK.name,
    description:
      "",
    concept: "mixed",
    schema: MIXED_NETWORK,
  },
  {
    id: DEFAULT_CHAIN.id,
    name: DEFAULT_CHAIN.name,
    description: "A root variable X₁ directly causes both X₂ and X₃: a fork structure with no mediation.",
    concept: "fork",
    schema: DEFAULT_CHAIN,
  },
  {
    id: MEDIATION_CHAIN.id,
    name: MEDIATION_CHAIN.name,
    description: "X₁ causes X₂, which in turn causes X₃. The effect of X₁ on X₃ is fully mediated through X₂.",
    concept: "mediation",
    schema: MEDIATION_CHAIN,
  },
  {
    id: SPURIOUS_CORRELATION.id,
    name: SPURIOUS_CORRELATION.name,
    description:
      "Temperature is a common cause of both ice cream sales and drowning incidents. The two are correlated in the data, but neither causes the other: a classic illustration of confounding.",
    concept: "fork",
    schema: SPURIOUS_CORRELATION,
  },
  {
    id: EDUCATION_INCOME.id,
    name: EDUCATION_INCOME.name,
    description:
      "Years of education raise skill level, and skill level (not education directly) drives income. The effect of education on income is fully mediated through skill.",
    concept: "mediation",
    schema: EDUCATION_INCOME,
  },
  {
    id: SMOKING_CANCER.id,
    name: SMOKING_CANCER.name,
    description:
      "Smoking raises cancer risk through tar buildup, but an underlying genotype also independently affects both smoking behavior and cancer risk directly, creating a backdoor path.",
    concept: "confounded mediation",
    schema: SMOKING_CANCER,
  },
  {
    id: TALENT_LUCK_SUCCESS.id,
    name: TALENT_LUCK_SUCCESS.name,
    description:
      "Talent and luck are independent causes that both feed into success. Conditioning on success alone induces a spurious negative association between talent and luck.",
    concept: "collider",
    schema: TALENT_LUCK_SUCCESS,
  },
  {
    id: EXERCISE_HEALTH.id,
    name: EXERCISE_HEALTH.name,
    description:
      "Exercise improves health through two separate mediating paths: lowering body weight and improving mood, which then jointly determine the health outcome.",
    concept: "diamond",
    schema: EXERCISE_HEALTH,
  },
];