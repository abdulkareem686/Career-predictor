const express = require('express');
const path = require('path');
const dotenv = require('dotenv');
const session = require('express-session');
const fs = require('fs');
const { paystackWebhookHandler } = require('./routes/webhooks');
const paymentRoutes = require('./routes/payments');
const authRoutes = require('./routes/auth');
const { configurePassport, passport } = require('./auth/passport');
const { attachUser, requireAuth, saveUserProgress, loadUserProgress } = require('./auth/middleware');
const { attachPremiumStatus, requirePremium, limitResultsForFree, resolvePremiumStatus } = require('./payments/middleware');

// Load environment variables
dotenv.config();

configurePassport();

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================
// MIDDLEWARE CONFIGURATION
// ============================================

// Paystack webhook — raw body required for signature verification
app.post('/api/webhooks/paystack', express.raw({ type: 'application/json' }), paystackWebhookHandler);

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(session({
   secret: process.env.SESSION_SECRET || 'career_predictor_secret_2024',
   resave: false,
   saveUninitialized: false,
   cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

app.use(passport.initialize());
app.use(passport.session());
app.use(attachUser);
app.use(attachPremiumStatus);
app.use(authRoutes);
app.use(paymentRoutes);

app.use(express.static(path.join(__dirname, 'public')));

// ============================================
// VIEW ENGINE CONFIGURATION
// ============================================

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('view cache', false);

// ============================================
// DATA LOADING
// ============================================

let coursesData = [];
let careersData = [];
let scholarshipsData = [];

try {
   const coursesFile = fs.readFileSync('./data/courses.json', 'utf8');
   const careersFile = fs.readFileSync('./data/careers.json', 'utf8');
   const scholarshipsFile = fs.readFileSync('./data/scholarships.json', 'utf8');
   coursesData = JSON.parse(coursesFile);
   careersData = JSON.parse(careersFile);
   scholarshipsData = JSON.parse(scholarshipsFile);
} catch (error) {
   console.error('Error loading data files:', error);
   // Use default data
   coursesData = { courses: [] };
   careersData = { careers: [] };
   scholarshipsData = { scholarships: [] };
}

// ============================================
// RECOMMENDATION ENGINE
// ============================================

class RecommendationEngine {
   constructor() {
      this.courses = coursesData.courses || [];
      this.careers = careersData.careers || [];
   }

   calculateSubjectMatch(studentSubjects, requiredSubjects) {
      if (!requiredSubjects || requiredSubjects.length === 0) return 0;

      const studentSubjectsLower = studentSubjects.map(s => s.toLowerCase());
      const requiredSubjectsLower = requiredSubjects.map(s => s.toLowerCase());

      const matches = requiredSubjectsLower.filter(sub =>
         studentSubjectsLower.some(s => s.includes(sub) || sub.includes(s))
      );

      return (matches.length / requiredSubjects.length) * 100;
   }

   calculateInterestMatch(studentInterests, requiredInterests) {
      if (!requiredInterests || requiredInterests.length === 0) return 0;
      if (!studentInterests || studentInterests.length === 0) return 0;

      const studentInterestsLower = studentInterests.map(i => i.toLowerCase());
      const requiredInterestsLower = requiredInterests.map(i => i.toLowerCase());

      const matches = requiredInterestsLower.filter(interest =>
         studentInterestsLower.some(i => i.includes(interest) || interest.includes(i))
      );

      return (matches.length / requiredInterests.length) * 100;
   }

   calculateSkillMatch(studentSkills, requiredSkills) {
      if (!requiredSkills || requiredSkills.length === 0) return 0;
      if (!studentSkills || studentSkills.length === 0) return 0;

      const studentSkillsLower = studentSkills.map(s => s.toLowerCase());
      const requiredSkillsLower = requiredSkills.map(s => s.toLowerCase());

      const matches = requiredSkillsLower.filter(skill =>
         studentSkillsLower.some(s => s.includes(skill) || skill.includes(s))
      );

      return (matches.length / requiredSkills.length) * 100;
   }

   calculatePersonalityMatch(studentPersonality, requiredPersonality) {
      if (!requiredPersonality || Object.keys(requiredPersonality).length === 0) return 50;
      if (!studentPersonality || Object.keys(studentPersonality).length === 0) return 50;

      let totalDiff = 0;
      let count = 0;

      Object.keys(requiredPersonality).forEach(key => {
         if (studentPersonality[key] !== undefined) {
            totalDiff += Math.abs(studentPersonality[key] - requiredPersonality[key]);
            count++;
         }
      });

      if (count === 0) return 50;

      const avgDiff = totalDiff / count;
      const score = Math.max(0, 100 - avgDiff);
      return score;
   }

   calculateGPA(studentGrades) {
      if (!studentGrades || Object.keys(studentGrades).length === 0) return 0;

      const grades = Object.values(studentGrades).filter(g => typeof g === 'number' && !isNaN(g));
      if (grades.length === 0) return 0;

      const average = grades.reduce((a, b) => a + b, 0) / grades.length;
      return (average / 100) * 4.0;
   }

   calculateCourseScore(student, course) {
      const subjectScore = this.calculateSubjectMatch(
         student.favoriteSubjects || [],
         course.requiredSubjects || []
      );

      const interestScore = this.calculateInterestMatch(
         student.interests || [],
         course.careerPaths || []
      );

      const skillScore = this.calculateSkillMatch(
         student.skills || [],
         course.requiredSkills || []
      );

      const gpa = this.calculateGPA(student.grades || {});
      const gpaRequirement = course.requiredGPA || 3.0;
      const gpaScore = Math.min((gpa / gpaRequirement) * 100, 100);

      const weights = {
         subject: 0.30,
         interest: 0.25,
         skill: 0.20,
         gpa: 0.25
      };

      const totalScore = (
         subjectScore * weights.subject +
         interestScore * weights.interest +
         skillScore * weights.skill +
         gpaScore * weights.gpa
      );

      return {
         score: Math.round(totalScore * 10) / 10,
         subjectScore: Math.round(subjectScore * 10) / 10,
         interestScore: Math.round(interestScore * 10) / 10,
         skillScore: Math.round(skillScore * 10) / 10,
         gpaScore: Math.round(gpaScore * 10) / 10,
         gpa: Math.round(gpa * 100) / 100
      };
   }

   calculateCareerScore(student, career) {
      const subjectScore = this.calculateSubjectMatch(
         student.favoriteSubjects || [],
         career.requiredSubjects || []
      );

      const interestScore = this.calculateInterestMatch(
         student.interests || [],
         career.interests || []
      );

      const skillScore = this.calculateSkillMatch(
         student.skills || [],
         career.requiredSkills || []
      );

      const personalityScore = this.calculatePersonalityMatch(
         student.personalityScores || {},
         career.personalityTraits || {}
      );

      const weights = {
         subject: 0.25,
         interest: 0.25,
         skill: 0.25,
         personality: 0.25
      };

      const totalScore = (
         subjectScore * weights.subject +
         interestScore * weights.interest +
         skillScore * weights.skill +
         personalityScore * weights.personality
      );

      return {
         score: Math.round(totalScore * 10) / 10,
         subjectScore: Math.round(subjectScore * 10) / 10,
         interestScore: Math.round(interestScore * 10) / 10,
         skillScore: Math.round(skillScore * 10) / 10,
         personalityScore: Math.round(personalityScore * 10) / 10
      };
   }

   calculateConfidence(score, dataPoints) {
      const scoreConfidence = Math.min(score / 100, 1);
      const dataConfidence = Math.min(dataPoints / 5, 1);
      return Math.round((scoreConfidence * 0.7 + dataConfidence * 0.3) * 100);
   }

   generateCourseExplanation(student, course, scores) {
      const explanations = [];

      if (scores.subjectScore > 70) {
         explanations.push({
            type: 'strength',
            text: `Your performance in ${(course.requiredSubjects || []).join(', ')} is strong, making you well-suited for this program.`
         });
      } else if (scores.subjectScore > 40) {
         explanations.push({
            type: 'potential',
            text: `You have shown interest in ${(course.requiredSubjects || []).join(', ')}, which aligns with this course.`
         });
      } else {
         explanations.push({
            type: 'development',
            text: `Consider developing stronger foundations in ${(course.requiredSubjects || []).join(', ')} for this course.`
         });
      }

      if (scores.interestScore > 70) {
         explanations.push({
            type: 'strength',
            text: `Your interests in ${(course.careerPaths || []).slice(0, 2).join(', ')} perfectly match this course's career paths.`
         });
      } else if (scores.interestScore > 40) {
         explanations.push({
            type: 'potential',
            text: `Some of your interests align with this course's career opportunities.`
         });
      } else {
         explanations.push({
            type: 'development',
            text: `Explore if the career paths from this course align with your interests.`
         });
      }

      const gpa = scores.gpa || 0;
      const requiredGPA = course.requiredGPA || 3.0;
      if (gpa >= requiredGPA) {
         explanations.push({
            type: 'strength',
            text: `Your GPA of ${gpa} meets the requirement of ${requiredGPA} for this program.`
         });
      } else {
         explanations.push({
            type: 'development',
            text: `You need a GPA of ${requiredGPA} for this program. Your current GPA is ${gpa}. Consider improving your grades.`
         });
      }

      if (course.scholarshipAvailable && scores.score > 70) {
         explanations.push({
            type: 'opportunity',
            text: `You may be eligible for scholarships in this program based on your performance.`
         });
      }

      return explanations;
   }

   generateCareerExplanation(student, career, scores) {
      const explanations = [];

      if (scores.subjectScore > 70) {
         explanations.push({
            type: 'strength',
            text: `Your performance in ${(career.requiredSubjects || []).join(', ')} is excellent for this career.`
         });
      } else if (scores.subjectScore > 40) {
         explanations.push({
            type: 'potential',
            text: `Your academic background has some alignment with this career's requirements.`
         });
      } else {
         explanations.push({
            type: 'development',
            text: `Consider taking more subjects in ${(career.requiredSubjects || []).join(', ')} for this career.`
         });
      }

      if (scores.interestScore > 70) {
         explanations.push({
            type: 'strength',
            text: `Your interests in ${(career.interests || []).slice(0, 2).join(', ')} strongly align with this career.`
         });
      } else if (scores.interestScore > 40) {
         explanations.push({
            type: 'potential',
            text: `Some of your interests match this career path.`
         });
      } else {
         explanations.push({
            type: 'development',
            text: `Explore if ${(career.interests || []).slice(0, 2).join(', ')} interest you for this career.`
         });
      }

      if (scores.skillScore > 70) {
         explanations.push({
            type: 'strength',
            text: `Your skills in ${(career.requiredSkills || []).slice(0, 2).join(', ')} are highly valued in this career.`
         });
      } else if (scores.skillScore > 40) {
         explanations.push({
            type: 'potential',
            text: `You have some of the key skills needed for this career.`
         });
      } else {
         explanations.push({
            type: 'development',
            text: `Consider developing ${(career.requiredSkills || []).slice(0, 2).join(', ')} for this career.`
         });
      }

      if (scores.personalityScore > 70) {
         explanations.push({
            type: 'strength',
            text: `Your personality traits match well with the requirements of this career.`
         });
      } else if (scores.personalityScore > 40) {
         explanations.push({
            type: 'potential',
            text: `Your personality has some alignment with this career's demands.`
         });
      } else {
         explanations.push({
            type: 'development',
            text: `This career may require a different personality type. Consider if you can adapt.`
         });
      }

      if (career.growthRate && career.averageSalary) {
         explanations.push({
            type: 'opportunity',
            text: `This career offers ${career.growthRate} growth with an average salary of $${(career.averageSalary || 0).toLocaleString()}.`
         });
      }

      return explanations;
   }

   getRecommendations(studentData) {
      const results = {
         courses: [],
         careers: []
      };

      this.courses.forEach(course => {
         const scores = this.calculateCourseScore(studentData, course);
         const confidence = this.calculateConfidence(scores.score, 4);

         results.courses.push({
            ...course,
            scores: scores,
            confidence: confidence,
            rankingScore: Math.round((scores.score * 0.7 + confidence * 0.3) * 10) / 10,
            explanations: this.generateCourseExplanation(studentData, course, scores)
         });
      });

      this.careers.forEach(career => {
         const scores = this.calculateCareerScore(studentData, career);
         const confidence = this.calculateConfidence(scores.score, 4);

         results.careers.push({
            ...career,
            scores: scores,
            confidence: confidence,
            rankingScore: Math.round((scores.score * 0.7 + confidence * 0.3) * 10) / 10,
            explanations: this.generateCareerExplanation(studentData, career, scores)
         });
      });

      results.courses.sort((a, b) => b.rankingScore - a.rankingScore);
      results.careers.sort((a, b) => b.rankingScore - a.rankingScore);

      results.courses = results.courses.slice(0, 10);
      results.careers = results.careers.slice(0, 10);

      return results;
   }
}

// ============================================
// SCHOLARSHIP ENGINE
// ============================================

class ScholarshipEngine {
   constructor() {
      this.scholarships = scholarshipsData.scholarships || [];
      this.categories = [
         "Nigerian Scholarships",
         "African Scholarships",
         "International Scholarships",
         "STEM Scholarships",
         "Merit Scholarships"
      ];
   }

   calculateConfidence(score, dataPoints) {
      const scoreConfidence = Math.min(score / 100, 1);
      const dataConfidence = Math.min(dataPoints / 5, 1);
      return Math.round((scoreConfidence * 0.7 + dataConfidence * 0.3) * 100);
   }

   calculateScholarshipMatch(student, scholarship) {
      let score = 0;
      const matchDetails = [];
      const breakdown = {
         academicMatch: 50,
         interestMatch: 50,
         careerMatch: 50,
         gpaMatch: 50
      };
      const weights = {
         gpa: 0.30,
         field: 0.25,
         level: 0.20,
         interests: 0.15,
         nationality: 0.10
      };
      const eligibleFields = scholarship.eligibility?.fields || scholarship.eligibility?.field || [];

      if (scholarship.eligibility && scholarship.eligibility.gpa) {
         const studentGPA = student.gpa || 0;
         const requiredGPA = scholarship.eligibility.gpa;
         breakdown.gpaMatch = studentGPA >= requiredGPA
            ? 100
            : Math.round((studentGPA / requiredGPA) * 100);
         if (studentGPA >= requiredGPA) {
            score += 100 * weights.gpa;
            matchDetails.push({
               factor: "GPA Requirement",
               status: "Met",
               detail: `Your GPA (${studentGPA.toFixed(2)}) meets the requirement (${requiredGPA})`
            });
         } else {
            score += breakdown.gpaMatch * weights.gpa;
            matchDetails.push({
               factor: "GPA Requirement",
               status: "Partial",
               detail: `Your GPA (${studentGPA.toFixed(2)}) is below the requirement (${requiredGPA})`
            });
         }
      }

      if (eligibleFields.length > 0) {
         const studentInterests = student.interests || [];
         const requiredFields = eligibleFields.map((f) => f.toLowerCase());
         const matchingFields = studentInterests.filter((interest) =>
            requiredFields.some((field) =>
               interest.toLowerCase().includes(field) || field.includes(interest.toLowerCase())
            )
         );
         const fieldMatchScore = (matchingFields.length / Math.max(requiredFields.length, 1)) * 100;
         breakdown.interestMatch = Math.round(fieldMatchScore);
         score += fieldMatchScore * weights.field;
         if (matchingFields.length > 0) {
            matchDetails.push({
               factor: "Field of Study",
               status: "Match",
               detail: `Your interests (${matchingFields.join(', ')}) align with this scholarship`
            });
         } else {
            matchDetails.push({
               factor: "Field of Study",
               status: "Partial",
               detail: `Consider fields like ${requiredFields.join(', ')} for this scholarship`
            });
         }
      }

      if (scholarship.eligibility && scholarship.eligibility.level) {
         const studentLevel = student.schoolLevel || "";
         const requiredLevels = scholarship.eligibility.level.map((l) => l.toLowerCase());
         const levelMatch = requiredLevels.some((level) =>
            studentLevel.toLowerCase().includes(level) || level.includes(studentLevel.toLowerCase())
         );
         breakdown.academicMatch = levelMatch ? 100 : 35;
         if (levelMatch) {
            score += 100 * weights.level;
            matchDetails.push({
               factor: "Academic Level",
               status: "Met",
               detail: `Your level (${studentLevel}) is eligible for this scholarship`
            });
         } else {
            matchDetails.push({
               factor: "Academic Level",
               status: "Partial",
               detail: `This scholarship is for ${requiredLevels.join(', ')} levels`
            });
         }
      }

      if (student.interests && eligibleFields.length > 0) {
         const matchingInterests = student.interests.filter((interest) =>
            eligibleFields.some((field) =>
               field.toLowerCase().includes(interest.toLowerCase()) ||
               interest.toLowerCase().includes(field.toLowerCase())
            )
         );
         const interestScore = matchingInterests.length > 0
            ? Math.min(100, (matchingInterests.length / Math.max(student.interests.length, 1)) * 100)
            : 0;
         breakdown.careerMatch = Math.round(interestScore);
         score += interestScore * weights.interests;
         if (matchingInterests.length > 0) {
            matchDetails.push({
               factor: "Career Alignment",
               status: "Good",
               detail: `Your career interests align with this scholarship's focus`
            });
         }
      }

      if (scholarship.eligibility && scholarship.eligibility.citizenship) {
         const studentNationality = student.nationality || "Nigerian";
         const requiredCitizenship = scholarship.eligibility.citizenship.map(c => c.toLowerCase());
         const citizenshipMatch = requiredCitizenship.some(c =>
            studentNationality.toLowerCase().includes(c) || c.includes(studentNationality.toLowerCase())
         );
         if (citizenshipMatch) {
            score += 100 * weights.nationality;
            matchDetails.push({
               factor: "Citizenship",
               status: "Met",
               detail: `You are eligible as a ${studentNationality} citizen`
            });
         } else {
            matchDetails.push({
               factor: "Citizenship",
               status: "Not Met",
               detail: `This scholarship requires ${requiredCitizenship.join(', ')} citizenship`
            });
         }
      }

      if (scholarship.category === "STEM Scholarships") {
         const stemInterests = student.interests.filter(i =>
            ["technology", "engineering", "science", "mathematics", "coding", "data"].some(
               stem => i.toLowerCase().includes(stem)
            )
         );
         if (stemInterests.length > 0) {
            score += 10;
            matchDetails.push({
               factor: "STEM Bonus",
               status: "Bonus",
               detail: "STEM scholarship bonus applied"
            });
         }
      }

      if (scholarship.category === "Merit Scholarships" && student.gpa >= 3.8) {
         score += 15;
         matchDetails.push({
            factor: "Merit Bonus",
            status: "Bonus",
            detail: "High academic achievement bonus applied"
         });
      }

      return {
         score: Math.min(Math.round(score), 100),
         details: matchDetails,
         breakdown,
         matchLevel: this.getMatchLevel(score)
      };
   }

   getMatchLevel(score) {
      if (score >= 80) return "Excellent";
      if (score >= 65) return "Good";
      if (score >= 50) return "Moderate";
      return "Low";
   }

   getRecommendations(student) {
      const recommendations = [];

      this.scholarships.forEach(scholarship => {
         const matchResult = this.calculateScholarshipMatch(student, scholarship);

         const deadline = new Date(scholarship.deadline);
         const today = new Date();
         const isOpen = deadline > today;

         recommendations.push({
            ...scholarship,
            matchScore: matchResult.score,
            matchLevel: matchResult.matchLevel,
            matchDetails: matchResult.breakdown,
            confidence: this.calculateConfidence(matchResult.score, matchResult.details.length),
            isOpen: isOpen,
            daysUntilDeadline: isOpen ? Math.ceil((deadline - today) / (1000 * 60 * 60 * 24)) : 0,
            rankingScore: matchResult.score * 0.8 + (isOpen ? 20 : 0)
         });
      });

      recommendations.sort((a, b) => b.rankingScore - a.rankingScore);

      const grouped = {};
      this.categories.forEach(category => {
         grouped[category] = recommendations.filter(r => r.category === category).slice(0, 3);
      });

      return {
         all: recommendations,
         grouped: grouped,
         top: recommendations.slice(0, 10)
      };
   }
}

// ============================================
// INITIALIZE ENGINES
// ============================================

const recommendationEngine = new RecommendationEngine();
const scholarshipEngine = new ScholarshipEngine();

// ============================================
// ROUTES
// ============================================

// Home page
app.get('/', (req, res) => {
   res.render('index');
});

// Assessment page (requires sign-in)
app.get('/assessment', requireAuth, (req, res) => {
   if (!req.session.assessmentData) {
      req.session.assessmentData = {};
   }
   if (req.user) {
      req.session.assessmentData.email = req.user.email;
      if (!req.session.assessmentData.studentName) {
         req.session.assessmentData.studentName = req.user.name;
      }
   }
   res.render('assessment', {
      formData: req.session.assessmentData,
      errors: null,
      currentStep: 1
   });
});

// Handle assessment form submission
app.post('/assessment', requireAuth, (req, res) => {
   const { step, ...formData } = req.body;
   const currentStep = parseInt(step) || 1;

   req.session.assessmentData = {
      ...req.session.assessmentData,
      ...formData
   };

   if (formData.favoriteSubjects) {
      req.session.assessmentData.favoriteSubjects = Array.isArray(formData.favoriteSubjects)
         ? formData.favoriteSubjects
         : [formData.favoriteSubjects];
   }

   if (formData.interests) {
      req.session.assessmentData.interests = Array.isArray(formData.interests)
         ? formData.interests
         : [formData.interests];
   }

   if (formData.skills) {
      req.session.assessmentData.skills = Array.isArray(formData.skills)
         ? formData.skills
         : [formData.skills];
   }

   const personalityAnswers = {};
   const personalityScores = {};
   for (let i = 1; i <= 15; i++) {
      const key = `personality_${i}`;
      if (formData[key]) {
         personalityAnswers[key] = formData[key];
      }
   }
   req.session.assessmentData.personalityAnswers = personalityAnswers;

   const questions = [
      { id: 1, trait: 'social' },
      { id: 2, trait: 'introvert' },
      { id: 3, trait: 'curious' },
      { id: 4, trait: 'creative' },
      { id: 5, trait: 'organized' },
      { id: 6, trait: 'risk_taker' },
      { id: 7, trait: 'empathetic' },
      { id: 8, trait: 'competitive' },
      { id: 9, trait: 'analytical' },
      { id: 10, trait: 'adaptable' },
      { id: 11, trait: 'leadership' },
      { id: 12, trait: 'patient' },
      { id: 13, trait: 'communication' },
      { id: 14, trait: 'analytical' },
      { id: 15, trait: 'passionate' }
   ];

   questions.forEach(q => {
      const key = `personality_${q.id}`;
      if (personalityAnswers[key]) {
         const value = parseInt(personalityAnswers[key]);
         personalityScores[q.trait] = ((value - 1) / 4) * 100;
      }
   });

   const traitAverages = {};
   Object.keys(personalityScores).forEach(trait => {
      const traitQuestions = questions.filter(q => q.trait === trait);
      if (traitQuestions.length > 1) {
         let sum = 0;
         traitQuestions.forEach(q => {
            const key = `personality_${q.id}`;
            if (personalityAnswers[key]) {
               sum += parseInt(personalityAnswers[key]);
            }
         });
         traitAverages[trait] = ((sum / traitQuestions.length) - 1) / 4 * 100;
      } else {
         traitAverages[trait] = personalityScores[trait];
      }
   });

   req.session.assessmentData.personalityScores = traitAverages;

   const nextStep = currentStep + 1;
   const totalSteps = 7;

   if (nextStep > totalSteps) {
      req.session.recommendations = null;
      req.session.studentData = null;
      saveUserProgress(req);
      return res.redirect('/results');
   }

   saveUserProgress(req);
   res.redirect(`/assessment#step-${nextStep}`);
});

// Enhanced Career Counseling Class
class CareerCounselor {
   constructor() {
      this.industryData = this.getIndustryData();
      this.salaryData = this.getSalaryData();
      this.futureTrends = this.getFutureTrends();
      this.personalityProfiles = this.getPersonalityProfiles();
   }

   // Get Industry Data
   getIndustryData() {
      return {
         'technology': {
            growth: 22,
            demand: 'High',
            stability: 'High',
            futureOutlook: 'Excellent',
            keySectors: ['Software Development', 'AI/ML', 'Cloud Computing', 'Cybersecurity'],
            emergingRoles: ['AI Ethics Officer', 'Quantum Computing Specialist', 'Edge AI Engineer']
         },
         'healthcare': {
            growth: 16,
            demand: 'Very High',
            stability: 'Very High',
            futureOutlook: 'Excellent',
            keySectors: ['Medical Research', 'Healthcare IT', 'Telemedicine', 'Biotechnology'],
            emergingRoles: ['Genomic Counselor', 'Digital Health Specialist', 'Medical AI Developer']
         },
         'business': {
            growth: 12,
            demand: 'High',
            stability: 'High',
            futureOutlook: 'Good',
            keySectors: ['Finance', 'Consulting', 'Marketing', 'Operations'],
            emergingRoles: ['Sustainability Consultant', 'Digital Transformation Lead', 'Data Strategist']
         },
         'engineering': {
            growth: 18,
            demand: 'High',
            stability: 'High',
            futureOutlook: 'Excellent',
            keySectors: ['Renewable Energy', 'Infrastructure', 'Aerospace', 'Manufacturing'],
            emergingRoles: ['Climate Engineer', 'Smart Cities Planner', 'Robotics Ethicist']
         },
         'education': {
            growth: 10,
            demand: 'High',
            stability: 'High',
            futureOutlook: 'Good',
            keySectors: ['EdTech', 'K-12 Education', 'Higher Education', 'Corporate Training'],
            emergingRoles: ['Learning Experience Designer', 'AI Education Specialist']
         }
      };
   }

   // Get Salary Data
   getSalaryData() {
      return {
         'Software Developer': { entry: 85000, mid: 120000, senior: 160000, top: 200000 },
         'Data Scientist': { entry: 90000, mid: 130000, senior: 170000, top: 220000 },
         'Medical Doctor': { entry: 120000, mid: 200000, senior: 300000, top: 450000 },
         'Business Analyst': { entry: 70000, mid: 95000, senior: 130000, top: 160000 },
         'Engineer': { entry: 75000, mid: 105000, senior: 145000, top: 180000 },
         'AI Engineer': { entry: 95000, mid: 140000, senior: 190000, top: 250000 },
         'Data Analyst': { entry: 65000, mid: 85000, senior: 115000, top: 140000 },
         'Machine Learning Engineer': { entry: 100000, mid: 150000, senior: 200000, top: 260000 },
         'Software Engineer': { entry: 88000, mid: 125000, senior: 165000, top: 210000 },
         'Product Manager': { entry: 80000, mid: 115000, senior: 155000, top: 200000 },
         'UI/UX Designer': { entry: 70000, mid: 95000, senior: 130000, top: 165000 },
         'DevOps Engineer': { entry: 85000, mid: 120000, senior: 160000, top: 195000 },
         'Cloud Architect': { entry: 90000, mid: 135000, senior: 180000, top: 230000 },
         'Cybersecurity Analyst': { entry: 78000, mid: 110000, senior: 150000, top: 190000 },
         'Project Manager': { entry: 75000, mid: 105000, senior: 140000, top: 175000 }
      };
   }

   // Get Future Trends
   getFutureTrends() {
      return {
         'technology': {
            trend: 'AI and Automation Revolution',
            impact: 'High',
            newJobs: ['AI Ethicist', 'Prompt Engineer', 'AI Integration Specialist'],
            risk: 'Medium',
            advice: 'Focus on AI literacy and human-AI collaboration skills'
         },
         'healthcare': {
            trend: 'Digital Health Transformation',
            impact: 'Very High',
            newJobs: ['Health Data Scientist', 'Digital Therapy Specialist', 'Remote Care Coordinator'],
            risk: 'Low',
            advice: 'Develop skills in healthcare technology and data analytics'
         },
         'business': {
            trend: 'Sustainable and Digital Business',
            impact: 'High',
            newJobs: ['Chief Sustainability Officer', 'Digital Transformation Lead', 'AI Business Strategist'],
            risk: 'Medium',
            advice: 'Combine traditional business skills with digital and sustainability knowledge'
         },
         'engineering': {
            trend: 'Green Engineering Revolution',
            impact: 'Very High',
            newJobs: ['Climate Engineer', 'Renewable Energy Specialist', 'Smart Infrastructure Designer'],
            risk: 'Low',
            advice: 'Focus on sustainable and green engineering practices'
         },
         'education': {
            trend: 'Personalized Learning Technology',
            impact: 'High',
            newJobs: ['Learning Experience Designer', 'EdTech Developer', 'Personalized Learning Specialist'],
            risk: 'Low',
            advice: 'Combine education expertise with technology skills'
         }
      };
   }

   // Get Personality Profiles
   getPersonalityProfiles() {
      return {
         'analytical': {
            name: 'Analytical Thinker',
            description: 'You excel at logical reasoning, problem-solving, and data-driven decision making.',
            strengths: ['Critical thinking', 'Pattern recognition', 'Systematic approach'],
            careerMatches: ['Data Scientist', 'Software Engineer', 'Financial Analyst', 'Researcher'],
            development: ['Creative thinking', 'Empathy', 'Leadership']
         },
         'creative': {
            name: 'Creative Visionary',
            description: 'You have strong creative instincts, innovative thinking, and design sensibilities.',
            strengths: ['Innovation', 'Design thinking', 'Artistic expression'],
            careerMatches: ['UI/UX Designer', 'Product Manager', 'Marketing Director', 'Architect'],
            development: ['Analytical skills', 'Project management', 'Business acumen']
         },
         'social': {
            name: 'Social Connector',
            description: 'You excel at communication, collaboration, and building relationships.',
            strengths: ['Communication', 'Empathy', 'Networking'],
            careerMatches: ['HR Manager', 'Sales Director', 'Community Manager', 'Counselor'],
            development: ['Technical skills', 'Data analysis', 'Strategic thinking']
         },
         'organized': {
            name: 'Strategic Organizer',
            description: 'You are highly organized, detail-oriented, and skilled at project management.',
            strengths: ['Planning', 'Organization', 'Execution'],
            careerMatches: ['Project Manager', 'Operations Director', 'Management Consultant'],
            development: ['Creativity', 'Flexibility', 'Interpersonal skills']
         },
         'leadership': {
            name: 'Natural Leader',
            description: 'You have strong leadership qualities, vision, and ability to inspire others.',
            strengths: ['Vision', 'Motivation', 'Decision making'],
            careerMatches: ['Executive', 'Entrepreneur', 'Team Lead', 'Policy Maker'],
            development: ['Technical depth', 'Empathy', 'Active listening']
         }
      };
   }

   // Generate Enhanced Career Profile
   generateCareerProfile(studentData, recommendations) {
      const profile = {
         personalityProfile: this.generatePersonalityProfile(studentData.personalityScores || {}),
         careerCompatibility: this.calculateCareerCompatibility(studentData, recommendations),
         futureDemand: this.analyzeFutureDemand(recommendations),
         salaryPotential: this.analyzeSalaryPotential(recommendations),
         industryGrowth: this.analyzeIndustryGrowth(recommendations),
         skillGapAnalysis: this.analyzeSkillGaps(studentData, recommendations),
         careerReadiness: this.calculateCareerReadiness(studentData, recommendations),
         intelligentExplanations: []
      };

      // Generate intelligent explanations
      profile.intelligentExplanations = this.generateIntelligentExplanations(studentData, recommendations, profile);

      return profile;
   }

   // Generate Personality Profile
   generatePersonalityProfile(personalityScores) {
      const traits = [];
      const profiles = this.personalityProfiles;

      // Identify dominant traits
      Object.keys(personalityScores).forEach(trait => {
         if (personalityScores[trait] > 60) {
            const profile = profiles[trait];
            if (profile) {
               traits.push({
                  trait: profile.name,
                  score: personalityScores[trait],
                  description: profile.description,
                  strengths: profile.strengths
               });
            }
         }
      });

      // Sort by score
      traits.sort((a, b) => b.score - a.score);

      // Determine primary and secondary traits
      const primaryTrait = traits[0] || null;
      const secondaryTrait = traits[1] || null;

      // Generate personality summary
      let summary = '';
      if (primaryTrait) {
         summary = `You are primarily a ${primaryTrait.trait}. ${primaryTrait.description}`;
         if (secondaryTrait) {
            summary += ` You also exhibit strong ${secondaryTrait.trait} qualities.`;
         }
      } else {
         summary = 'You have a balanced personality with versatile strengths.';
      }

      return {
         primary: primaryTrait,
         secondary: secondaryTrait,
         allTraits: traits,
         summary: summary,
         recommendations: this.getPersonalityRecommendations(traits)
      };
   }

   // Get Personality Recommendations
   getPersonalityRecommendations(traits) {
      const recommendations = [];
      const careerRecommendations = new Set();

      traits.forEach(trait => {
         const profile = Object.values(this.personalityProfiles).find(p => p.name === trait.trait);
         if (profile && profile.careerMatches) {
            profile.careerMatches.forEach(career => careerRecommendations.add(career));
         }
      });

      return {
         suggestedCareers: Array.from(careerRecommendations).slice(0, 5),
         advice: traits.map(t => {
            const profile = Object.values(this.personalityProfiles).find(p => p.name === t.trait);
            return profile ? `${t.trait}: ${profile.description}` : '';
         }).filter(Boolean)
      };
   }

   // Calculate Career Compatibility Score
   calculateCareerCompatibility(studentData, recommendations) {
      if (!recommendations || !recommendations.careers) {
         return { score: 0, breakdown: {} };
      }

      const careerScores = recommendations.careers.map(career => {
         let score = 0;
         const breakdown = {};

         // 1. Academic Compatibility (25%)
         const academicScore = career.scores.subjectScore || 0;
         breakdown.academic = academicScore;
         score += academicScore * 0.25;

         // 2. Interest Compatibility (25%)
         const interestScore = career.scores.interestScore || 0;
         breakdown.interests = interestScore;
         score += interestScore * 0.25;

         // 3. Skill Compatibility (25%)
         const skillScore = career.scores.skillScore || 0;
         breakdown.skills = skillScore;
         score += skillScore * 0.25;

         // 4. Personality Compatibility (25%)
         const personalityScore = career.scores.personalityScore || 0;
         breakdown.personality = personalityScore;
         score += personalityScore * 0.25;

         // 5. Bonus: Future Demand (Extra 10%)
         const futureDemand = this.getFutureDemandScore(career.name);
         score += futureDemand * 0.10;

         return {
            career: career.name,
            score: Math.min(score, 100),
            breakdown: breakdown,
            level: this.getMatchLevel(score)
         };
      });

      // Sort by score and get top matches
      careerScores.sort((a, b) => b.score - a.score);

      return {
         topMatches: careerScores.slice(0, 5),
         overallScore: careerScores.length > 0 ? careerScores[0].score : 0,
         breakdown: careerScores.length > 0 ? careerScores[0].breakdown : {}
      };
   }

   // Get Future Demand Score
   getFutureDemandScore(careerName) {
      const demandMap = {
         'Software Developer': 85,
         'Data Scientist': 90,
         'AI Engineer': 95,
         'Machine Learning Engineer': 95,
         'Cybersecurity Analyst': 88,
         'Cloud Architect': 90,
         'DevOps Engineer': 85,
         'Medical Doctor': 80,
         'Product Manager': 75,
         'Business Analyst': 72,
         'Data Analyst': 80,
         'UI/UX Designer': 70,
         'Project Manager': 68,
         'Engineer': 78,
         'Researcher': 75
      };

      // Find matching career
      for (const [key, value] of Object.entries(demandMap)) {
         if (careerName.toLowerCase().includes(key.toLowerCase()) ||
            key.toLowerCase().includes(careerName.toLowerCase())) {
            return value;
         }
      }
      return 65; // Default demand score
   }

   // Analyze Future Demand
   analyzeFutureDemand(recommendations) {
      if (!recommendations || !recommendations.careers) {
         return { demandScore: 0, trend: 'Unknown', analysis: [] };
      }

      const analysis = recommendations.careers.slice(0, 5).map(career => {
         const demandScore = this.getFutureDemandScore(career.name);
         const trend = this.getFutureTrend(career.name);
         return {
            career: career.name,
            demandScore: demandScore,
            trend: trend,
            growth: this.getGrowthRate(career.name)
         };
      });

      const averageDemand = analysis.reduce((sum, item) => sum + item.demandScore, 0) / analysis.length;

      return {
         demandScore: Math.round(averageDemand),
         trend: averageDemand > 80 ? 'High Growth' : averageDemand > 60 ? 'Steady Growth' : 'Developing',
         analysis: analysis
      };
   }

   // Get Future Trend
   getFutureTrend(careerName) {
      const trends = {
         'Software Developer': 'AI augmentation creating new opportunities',
         'Data Scientist': 'Explosive growth in data-driven industries',
         'AI Engineer': 'Critical role in digital transformation',
         'Machine Learning Engineer': 'Core to future technology development',
         'Cybersecurity Analyst': 'Essential due to increasing digital threats',
         'Cloud Architect': 'Foundational to modern IT infrastructure',
         'Medical Doctor': 'Evolving with telemedicine and AI diagnostics'
      };

      for (const [key, value] of Object.entries(trends)) {
         if (careerName.toLowerCase().includes(key.toLowerCase())) {
            return value;
         }
      }
      return 'Steady growth with technological integration';
   }

   // Get Growth Rate
   getGrowthRate(careerName) {
      const growthRates = {
         'Software Developer': 22,
         'Data Scientist': 35,
         'AI Engineer': 30,
         'Machine Learning Engineer': 28,
         'Cybersecurity Analyst': 33,
         'Cloud Architect': 27,
         'DevOps Engineer': 25,
         'Medical Doctor': 7,
         'Product Manager': 15,
         'Business Analyst': 14
      };

      for (const [key, value] of Object.entries(growthRates)) {
         if (careerName.toLowerCase().includes(key.toLowerCase())) {
            return value;
         }
      }
      return 10; // Default growth rate
   }

   // Analyze Salary Potential
   analyzeSalaryPotential(recommendations) {
      if (!recommendations || !recommendations.careers) {
         return { averageSalary: 0, potential: 'Unknown', careers: [] };
      }

      const salaryAnalysis = recommendations.careers.slice(0, 5).map(career => {
         const salary = this.getSalaryData(career.name);
         const growth = this.getGrowthRate(career.name);

         return {
            career: career.name,
            entrySalary: salary.entry || 0,
            midSalary: salary.mid || 0,
            seniorSalary: salary.senior || 0,
            growth: growth,
            earningPotential: this.getEarningPotential(salary)
         };
      });

      const averageEntry = salaryAnalysis.reduce((sum, item) => sum + item.entrySalary, 0) / salaryAnalysis.length;

      return {
         averageEntrySalary: Math.round(averageEntry),
         potential: averageEntry > 85000 ? 'High' : averageEntry > 65000 ? 'Medium' : 'Standard',
         careers: salaryAnalysis,
         advice: this.getSalaryAdvice(salaryAnalysis)
      };
   }

   // Get Earning Potential
   getEarningPotential(salary) {
      const total = (salary.entry || 0) + (salary.mid || 0) + (salary.senior || 0);
      if (total > 300000) return 'Excellent';
      if (total > 200000) return 'Very Good';
      if (total > 120000) return 'Good';
      return 'Standard';
   }

   // Get Salary Advice
   getSalaryAdvice(careers) {
      const highPaying = careers.filter(c => c.earningPotential === 'Excellent' || c.earningPotential === 'Very Good');
      if (highPaying.length > 0) {
         return `Focus on developing skills in ${highPaying.slice(0, 2).map(c => c.career).join(', ')} for maximum earning potential.`;
      }
      return 'Consider developing specialized skills to increase your earning potential.';
   }

   // Analyze Industry Growth
   analyzeIndustryGrowth(recommendations) {
      if (!recommendations || !recommendations.careers) {
         return { growthScore: 0, analysis: [] };
      }

      const industryAnalysis = recommendations.careers.slice(0, 5).map(career => {
         const industry = this.getIndustry(career.name);
         const industryData = this.industryData[industry];

         return {
            career: career.name,
            industry: industry,
            growth: industryData ? industryData.growth : 10,
            demand: industryData ? industryData.demand : 'Medium',
            outlook: industryData ? industryData.futureOutlook : 'Good',
            emergingRoles: industryData ? industryData.emergingRoles : []
         };
      });

      const averageGrowth = industryAnalysis.reduce((sum, item) => sum + item.growth, 0) / industryAnalysis.length;

      return {
         growthScore: Math.round(averageGrowth),
         analysis: industryAnalysis,
         highGrowthIndustries: industryAnalysis.filter(i => i.growth > 15).map(i => i.industry)
      };
   }

   // Get Industry
   getIndustry(careerName) {
      const industryMap = {
         'Software Developer': 'technology',
         'Data Scientist': 'technology',
         'AI Engineer': 'technology',
         'Machine Learning Engineer': 'technology',
         'Cybersecurity Analyst': 'technology',
         'Cloud Architect': 'technology',
         'DevOps Engineer': 'technology',
         'Medical Doctor': 'healthcare',
         'Product Manager': 'business',
         'Business Analyst': 'business',
         'Data Analyst': 'technology',
         'UI/UX Designer': 'technology',
         'Project Manager': 'business',
         'Engineer': 'engineering',
         'Researcher': 'education'
      };

      for (const [key, value] of Object.entries(industryMap)) {
         if (careerName.toLowerCase().includes(key.toLowerCase())) {
            return value;
         }
      }
      return 'technology'; // Default
   }

   // Analyze Skill Gaps
   analyzeSkillGaps(studentData, recommendations) {
      const existingSkills = studentData.skills || [];
      const requiredSkills = [];

      // Collect all required skills from career recommendations
      if (recommendations && recommendations.careers) {
         recommendations.careers.slice(0, 5).forEach(career => {
            if (career.requiredSkills) {
               career.requiredSkills.forEach(skill => {
                  if (!requiredSkills.includes(skill)) {
                     requiredSkills.push(skill);
                  }
               });
            }
         });
      }

      // Identify gaps
      const gaps = requiredSkills.filter(skill =>
         !existingSkills.some(s =>
            s.toLowerCase().includes(skill.toLowerCase()) ||
            skill.toLowerCase().includes(s.toLowerCase())
         )
      );

      // Identify strengths (skills that match)
      const strengths = requiredSkills.filter(skill =>
         existingSkills.some(s =>
            s.toLowerCase().includes(skill.toLowerCase()) ||
            skill.toLowerCase().includes(s.toLowerCase())
         )
      );

      return {
         totalRequired: requiredSkills.length,
         existing: strengths.length,
         gaps: gaps.length,
         gapList: gaps.slice(0, 10),
         strengthsList: strengths.slice(0, 10),
         readiness: strengths.length / Math.max(requiredSkills.length, 1) * 100
      };
   }

   // Calculate Career Readiness
   calculateCareerReadiness(studentData, recommendations) {
      if (!recommendations || !recommendations.careers) {
         return { score: 0, level: 'Not Ready', advice: [] };
      }

      const topCareer = recommendations.careers[0];
      if (!topCareer) return { score: 0, level: 'Not Ready', advice: [] };

      // Calculate readiness based on multiple factors
      const factors = {
         academic: topCareer.scores.subjectScore || 0,
         skills: topCareer.scores.skillScore || 0,
         interests: topCareer.scores.interestScore || 0,
         personality: topCareer.scores.personalityScore || 0
      };

      const averageScore = Object.values(factors).reduce((sum, val) => sum + val, 0) / Object.values(factors).length;

      let level = 'Not Ready';
      let advice = [];

      if (averageScore >= 80) {
         level = 'Highly Ready';
         advice = ['You are well-prepared for this career path', 'Continue building advanced skills', 'Start networking in the industry'];
      } else if (averageScore >= 60) {
         level = 'Moderately Ready';
         advice = ['Focus on developing key skills', 'Consider internships for experience', 'Build your professional network'];
      } else {
         advice = [
            'Develop foundational skills in this area',
            'Consider related entry-level positions',
            'Seek mentorship from industry professionals'
         ];
      }

      return {
         score: Math.round(averageScore),
         level: level,
         factors: factors,
         advice: advice,
         strengths: this.getReadinessStrengths(factors),
         improvements: this.getReadinessImprovements(factors)
      };
   }

   // Get Readiness Strengths
   getReadinessStrengths(factors) {
      const strengths = [];
      if (factors.academic >= 70) strengths.push('Strong academic foundation');
      if (factors.skills >= 70) strengths.push('Good skill alignment');
      if (factors.interests >= 70) strengths.push('High interest alignment');
      if (factors.personality >= 70) strengths.push('Good personality fit');
      return strengths;
   }

   // Get Readiness Improvements
   getReadinessImprovements(factors) {
      const improvements = [];
      if (factors.academic < 60) improvements.push('Improve academic performance');
      if (factors.skills < 60) improvements.push('Develop relevant skills');
      if (factors.interests < 60) improvements.push('Explore career interests further');
      if (factors.personality < 60) improvements.push('Consider personality development');
      return improvements;
   }

   // Get Match Level
   getMatchLevel(score) {
      if (score >= 80) return 'Excellent';
      if (score >= 65) return 'Good';
      if (score >= 50) return 'Moderate';
      return 'Needs Improvement';
   }

   // Generate Intelligent Explanations
   generateIntelligentExplanations(studentData, recommendations, profile) {
      const explanations = [];
      const topCareer = recommendations && recommendations.careers ? recommendations.careers[0] : null;

      if (topCareer) {
         // Career Explanation
         explanations.push({
            type: 'career_match',
            title: `Why ${topCareer.name} is a Great Fit for You`,
            content: this.generateCareerExplanation(topCareer, studentData, profile)
         });

         // Personality Explanation
         if (profile.personalityProfile.primary) {
            explanations.push({
               type: 'personality_match',
               title: `Your ${profile.personalityProfile.primary.trait} Personality`,
               content: this.generatePersonalityExplanation(profile.personalityProfile, topCareer)
            });
         }

         // Growth Potential Explanation
         explanations.push({
            type: 'growth_potential',
            title: 'Your Growth Potential',
            content: this.generateGrowthExplanation(topCareer, profile)
         });

         // Industry Trend Explanation
         const industry = this.getIndustry(topCareer.name);
         const trend = this.futureTrends[industry];
         if (trend) {
            explanations.push({
               type: 'industry_trend',
               title: 'Industry Trends & Future Outlook',
               content: this.generateTrendExplanation(trend, industry)
            });
         }

         // Salary Explanation
         const salaryData = this.getSalaryData(topCareer.name);
         if (salaryData && salaryData.entry) {
            explanations.push({
               type: 'salary_potential',
               title: 'Salary & Earning Potential',
               content: this.generateSalaryExplanation(salaryData, topCareer)
            });
         }

         // Skill Gap Explanation
         if (profile.skillGapAnalysis.gaps > 0) {
            explanations.push({
               type: 'skill_gap',
               title: 'Skills to Develop',
               content: this.generateSkillGapExplanation(profile.skillGapAnalysis, topCareer)
            });
         }
      }

      return explanations;
   }

   // Generate Career Explanation
   generateCareerExplanation(career, studentData, profile) {
      const parts = [];

      // Academic match
      const academicScore = career.scores.subjectScore || 0;
      if (academicScore > 70) {
         parts.push(`Your strong academic performance in ${career.requiredSubjects ? career.requiredSubjects.slice(0, 2).join(', ') : 'relevant subjects'} directly aligns with the requirements for ${career.name}.`);
      } else if (academicScore > 40) {
         parts.push(`Your academic background in ${career.requiredSubjects ? career.requiredSubjects.slice(0, 2).join(', ') : 'relevant subjects'} provides a solid foundation for ${career.name}.`);
      } else {
         parts.push(`While your current academic focus differs from ${career.name}, your analytical skills and dedication to learning will help you succeed.`);
      }

      // Interest match
      const interestScore = career.scores.interestScore || 0;
      if (interestScore > 70) {
         parts.push(`Your interests in ${studentData.interests ? studentData.interests.slice(0, 2).join(', ') : 'related areas'} strongly align with what makes ${career.name} rewarding.`);
      }

      // Personality match
      if (profile.personalityProfile.primary) {
         parts.push(`Your ${profile.personalityProfile.primary.trait} personality is particularly well-suited for ${career.name}, where ${profile.personalityProfile.primary.strengths.slice(0, 2).join(', ')} are highly valued.`);
      }

      // Skills match
      const skillScore = career.scores.skillScore || 0;
      if (skillScore > 70) {
         parts.push(`You already possess key skills like ${career.requiredSkills ? career.requiredSkills.slice(0, 2).join(', ') : 'critical competencies'} that are essential for ${career.name}.`);
      }

      return parts.join(' ');
   }

   // Generate Personality Explanation
   generatePersonalityExplanation(personalityProfile, career) {
      const parts = [];

      if (personalityProfile.primary) {
         parts.push(`Your ${personalityProfile.primary.trait} personality type brings unique strengths to ${career.name}.`);
         parts.push(`You excel at ${personalityProfile.primary.strengths.slice(0, 2).join(', ')}, which are critical for success in this field.`);
      }

      if (personalityProfile.secondary) {
         parts.push(`Your secondary ${personalityProfile.secondary.trait} traits complement this by providing ${personalityProfile.secondary.strengths.slice(0, 2).join(', ')}.`);
      }

      return parts.join(' ');
   }

   // Generate Growth Explanation
   generateGrowthExplanation(career, profile) {
      const parts = [];
      const growth = this.getGrowthRate(career.name);
      const demand = this.getFutureDemandScore(career.name);
      const industry = this.getIndustry(career.name);
      const industryData = this.industryData[industry];

      if (growth > 20) {
         parts.push(`The demand for ${career.name} professionals is growing at an exceptional rate of ${growth}%, outpacing many other industries.`);
      } else if (growth > 15) {
         parts.push(`The ${career.name} profession shows strong growth potential at ${growth}%, indicating excellent career prospects.`);
      } else {
         parts.push(`${career.name} offers stable growth opportunities at ${growth}%, with consistent demand for skilled professionals.`);
      }

      if (industryData && industryData.emergingRoles) {
         parts.push(`Emerging roles like ${industryData.emergingRoles.slice(0, 2).join(', ')} are creating new opportunities in this field.`);
      }

      const readiness = profile.careerReadiness;
      if (readiness.level === 'Highly Ready') {
         parts.push('You are well-positioned to capitalize on these growth opportunities immediately.');
      } else if (readiness.level === 'Moderately Ready') {
         parts.push('With targeted skill development, you can position yourself for these growth opportunities.');
      }

      return parts.join(' ');
   }

   // Generate Trend Explanation
   generateTrendExplanation(trend, industry) {
      const parts = [];

      parts.push(`The ${industry} industry is undergoing a ${trend.trend.toLowerCase()}.`);
      parts.push(`This trend has a ${trend.impact} impact on career opportunities.`);

      if (trend.newJobs && trend.newJobs.length > 0) {
         parts.push(`New roles such as ${trend.newJobs.slice(0, 3).join(', ')} are emerging, creating exciting career paths.`);
      }

      parts.push(`Advice: ${trend.advice}`);

      return parts.join(' ');
   }

   // Generate Salary Explanation
   generateSalaryExplanation(salaryData, career) {
      const parts = [];

      if (salaryData.entry) {
         parts.push(`Entry-level ${career.name} professionals typically earn $${salaryData.entry.toLocaleString()}`);
      }

      if (salaryData.mid) {
         parts.push(`with mid-career professionals earning $${salaryData.mid.toLocaleString()}.`);
      }

      if (salaryData.senior) {
         parts.push(`Senior professionals can expect $${salaryData.senior.toLocaleString()}, with top earners reaching $${salaryData.top.toLocaleString()}.`);
      }

      const growth = this.getGrowthRate(career.name);
      parts.push(`With a ${growth}% growth rate, you have strong potential for career advancement and salary growth.`);

      const earningPotential = this.getEarningPotential(salaryData);
      parts.push(`Overall, ${career.name} offers ${earningPotential.toLowerCase()} earning potential.`);

      return parts.join(' ');
   }

   // Generate Skill Gap Explanation
   generateSkillGapExplanation(skillGap, career) {
      const parts = [];

      if (skillGap.gaps === 0) {
         return `You already possess all the key skills needed for ${career.name}. Focus on refining and mastering these skills to advance your career.`;
      }

      parts.push(`To excel in ${career.name}, you'll benefit from developing ${skillGap.gaps} additional skills.`);

      if (skillGap.gapList && skillGap.gapList.length > 0) {
         const topGaps = skillGap.gapList.slice(0, 3);
         parts.push(`Priority areas include ${topGaps.join(', ')}.`);
      }

      if (skillGap.strengthsList && skillGap.strengthsList.length > 0) {
         parts.push(`Your existing strengths in ${skillGap.strengthsList.slice(0, 2).join(', ')} provide a solid foundation to build upon.`);
      }

      return parts.join(' ');
   }

   // Get Career Readiness Summary
   getReadinessSummary(profile) {
      const readiness = profile.careerReadiness;
      const parts = [];

      if (readiness.level === 'Highly Ready') {
         parts.push('🎯 You are highly ready for your recommended career path!');
         parts.push(`Your strengths include: ${readiness.strengths.join(', ')}.`);
      } else if (readiness.level === 'Moderately Ready') {
         parts.push('📈 You are on the right track to your career goals!');
         parts.push(`Focus areas include: ${readiness.improvements.join(', ')}.`);
      } else {
         parts.push('🚀 You have great potential! Here are steps to build your career readiness.');
         parts.push(`Start with: ${readiness.advice.slice(0, 2).join(' ')}`);
      }

      return parts.join(' ');
   }
}

// ============================================
// UPDATE RESULTS ROUTE WITH ENHANCED PROFILING
// ============================================

function buildResultsViewData(assessmentData) {
   const math = parseFloat(assessmentData.mathGrade) || 0;
   const english = parseFloat(assessmentData.englishGrade) || 0;
   const science = parseFloat(assessmentData.scienceGrade) || 0;
   const socialScience = parseFloat(assessmentData.socialScienceGrade) || 0;
   const technology = parseFloat(assessmentData.technologyGrade) || 0;
   const gradeTotal = math + english + science + socialScience + technology;

   const personalityTraits = [
      { key: 'analytical', label: 'Analytical', color: '#6366f1' },
      { key: 'creative', label: 'Creative', color: '#8b5cf6' },
      { key: 'social', label: 'Social', color: '#ec4899' },
      { key: 'organized', label: 'Organized', color: '#14b8a6' },
      { key: 'leadership', label: 'Leadership', color: '#f59e0b' },
      { key: 'communication', label: 'Communication', color: '#3b82f6' },
      { key: 'adaptable', label: 'Adaptable', color: '#10b981' },
      { key: 'empathetic', label: 'Empathetic', color: '#ef4444' }
   ].map((trait) => ({
      ...trait,
      score: Math.round(
         assessmentData.personalityScores && assessmentData.personalityScores[trait.key]
            ? assessmentData.personalityScores[trait.key]
            : 50
      )
   }));

   const gradeSubjects = [
      { name: 'Mathematics', score: math },
      { name: 'English', score: english },
      { name: 'Science', score: science },
      { name: 'Social Science', score: socialScience },
      { name: 'Technology', score: technology }
   ];

   return {
      averageScore: Math.round(math + english + science + socialScience + technology / 5),
      gpa: Math.round((gradeTotal / 500) * 4),
      personalityTraits,
      academicStrengths: gradeSubjects.filter((subject) => subject.score >= 70),
      academicWeaknesses: gradeSubjects.filter((subject) => subject.score < 50 && subject.score > 0)
   };
}

// Results page (requires sign-in)
app.get('/results', requireAuth, (req, res) => {
   const assessmentData = req.session.assessmentData || {};

   // If no assessment data, redirect to assessment
   if (Object.keys(assessmentData).length === 0) {
      return res.redirect('/assessment');
   }

   // Check if recommendations already exist in session
   let recommendations = req.session.recommendations;

   // If not, generate new recommendations
   if (!recommendations) {
      // Prepare student data for recommendation engine
      const studentData = {
         grades: {
            math: parseFloat(assessmentData.mathGrade) || 0,
            english: parseFloat(assessmentData.englishGrade) || 0,
            science: parseFloat(assessmentData.scienceGrade) || 0,
            socialScience: parseFloat(assessmentData.socialScienceGrade) || 0,
            technology: parseFloat(assessmentData.technologyGrade) || 0
         },
         favoriteSubjects: assessmentData.favoriteSubjects || [],
         interests: assessmentData.interests || [],
         skills: assessmentData.skills || [],
         personalityScores: assessmentData.personalityScores || {},
         careerGoals: assessmentData.careerGoals || '',
         dreamJob: assessmentData.dreamJob || '',
         futureAmbitions: assessmentData.futureAmbitions || ''
      };

      // Generate recommendations using enhanced engine
      recommendations = recommendationEngine.getRecommendations(studentData);

      // Initialize Career Counselor
      const counselor = new CareerCounselor();

      // Generate enhanced career profile
      const careerProfile = counselor.generateCareerProfile(studentData, recommendations);

      // Store in session
      req.session.recommendations = recommendations;
      req.session.studentData = studentData;
      req.session.careerProfile = careerProfile;
      saveUserProgress(req);
   }

   // Get career profile from session
   const careerProfile = req.session.careerProfile || {};
   const viewData = buildResultsViewData(assessmentData);
   const isPremium = resolvePremiumStatus(req);
   const displayResults = limitResultsForFree(recommendations, isPremium);

   res.render('results', {
      results: displayResults,
      fullResults: recommendations,
      assessmentData: assessmentData,
      careerProfile: isPremium ? careerProfile : {},
      averageScore: viewData.averageScore,
      gpa: viewData.gpa,
      personalityTraits: viewData.personalityTraits,
      academicStrengths: viewData.academicStrengths,
      academicWeaknesses: viewData.academicWeaknesses,
      isPremium: isPremium,
      premiumPlan: req.session.premiumPlan || null
   });
});

// Scholarship page (Pro feature, requires sign-in)
app.get('/scholarship', requireAuth, requirePremium, (req, res) => {
   const assessmentData = req.session.assessmentData || {};

   if (Object.keys(assessmentData).length === 0) {
      return res.redirect('/assessment');
   }

   const student = {
      gpa: Math.round(((parseFloat(assessmentData.mathGrade) || 0) +
         (parseFloat(assessmentData.englishGrade) || 0) +
         (parseFloat(assessmentData.scienceGrade) || 0) +
         (parseFloat(assessmentData.socialScienceGrade) || 0) +
         (parseFloat(assessmentData.technologyGrade) || 0)) / 500 * 4 * 100) / 100,
      interests: assessmentData.interests || [],
      skills: assessmentData.skills || [],
      favoriteSubjects: assessmentData.favoriteSubjects || [],
      schoolLevel: assessmentData.schoolLevel || "",
      nationality: "Nigerian",
      careerGoals: assessmentData.careerGoals || ""
   };

   const scholarshipResults = scholarshipEngine.getRecommendations(student);

   res.render('scholarship', {
      scholarships: scholarshipResults.all,
      categories: scholarshipResults.grouped,
      student: student,
      assessmentData: assessmentData,
      isPremium: true
   });
});

// Skills page with personalized recommendations (Pro feature, requires sign-in)
app.get('/skills', requireAuth, requirePremium, (req, res) => {
   const assessmentData = req.session.assessmentData || {};
   const recommendations = req.session.recommendations || null;

   // If no assessment data, redirect to assessment
   if (Object.keys(assessmentData).length === 0) {
      return res.redirect('/assessment');
   }

   // Generate personalized skills recommendations
   const skillsData = generateSkillsRecommendations(assessmentData, recommendations);

   res.render('skills', {
      skills: skillsData,
      assessmentData: assessmentData,
      recommendations: recommendations,
      isPremium: true
   });
});

// Skills recommendation engine
function generateSkillsRecommendations(assessmentData, recommendations) {
   const studentSkills = assessmentData.skills || [];
   const studentInterests = assessmentData.interests || [];
   const careerRecommendations = recommendations ? recommendations.careers : [];
   const courseRecommendations = recommendations ? recommendations.courses : [];

   // Define skill categories
   const skillCategories = {
      technical: {
         name: 'Technical Skills',
         icon: 'fa-code',
         description: 'Hard skills and technical competencies',
         skills: []
      },
      soft: {
         name: 'Soft Skills',
         icon: 'fa-handshake',
         description: 'Interpersonal and communication skills',
         skills: []
      },
      industry: {
         name: 'Industry Skills',
         icon: 'fa-industry',
         description: 'Domain-specific knowledge and expertise',
         skills: []
      },
      certifications: {
         name: 'Certifications',
         icon: 'fa-certificate',
         description: 'Professional certifications and credentials',
         skills: []
      }
   };

   // Define all possible skills with their details
   const skillDatabase = getSkillDatabase();

   // Identify skills gaps based on career recommendations
   let recommendedSkills = [];
   let skillPriorities = {};

   // 1. Extract skills from career recommendations
   careerRecommendations.slice(0, 5).forEach(career => {
      const careerSkills = career.requiredSkills || [];
      careerSkills.forEach(skill => {
         const skillInfo = findSkillInDatabase(skill, skillDatabase);
         if (skillInfo) {
            const priority = calculateSkillPriority(skillInfo, studentSkills, career);
            if (!skillPriorities[skillInfo.id]) {
               skillPriorities[skillInfo.id] = {
                  skill: skillInfo,
                  priority: priority,
                  sources: ['career']
               };
            } else {
               skillPriorities[skillInfo.id].priority = Math.max(
                  skillPriorities[skillInfo.id].priority,
                  priority
               );
               skillPriorities[skillInfo.id].sources.push('career');
            }
         }
      });
   });

   // 2. Extract skills from course recommendations
   courseRecommendations.slice(0, 5).forEach(course => {
      const courseSkills = course.requiredSkills || [];
      courseSkills.forEach(skill => {
         const skillInfo = findSkillInDatabase(skill, skillDatabase);
         if (skillInfo) {
            const priority = calculateSkillPriority(skillInfo, studentSkills, null, course);
            if (!skillPriorities[skillInfo.id]) {
               skillPriorities[skillInfo.id] = {
                  skill: skillInfo,
                  priority: priority,
                  sources: ['course']
               };
            } else {
               skillPriorities[skillInfo.id].priority = Math.max(
                  skillPriorities[skillInfo.id].priority,
                  priority
               );
               skillPriorities[skillInfo.id].sources.push('course');
            }
         }
      });
   });

   // 3. Add industry-specific skills based on interests
   studentInterests.forEach(interest => {
      const industrySkills = getIndustrySkills(interest);
      industrySkills.forEach(skill => {
         const skillInfo = findSkillInDatabase(skill, skillDatabase);
         if (skillInfo) {
            const priority = calculateSkillPriority(skillInfo, studentSkills);
            if (!skillPriorities[skillInfo.id]) {
               skillPriorities[skillInfo.id] = {
                  skill: skillInfo,
                  priority: priority,
                  sources: ['interest']
               };
            } else {
               skillPriorities[skillInfo.id].sources.push('interest');
            }
         }
      });
   });

   // Convert to array and sort by priority
   recommendedSkills = Object.values(skillPriorities)
      .filter(item => !studentSkills.some(s =>
         s.toLowerCase().includes(item.skill.name.toLowerCase()) ||
         item.skill.name.toLowerCase().includes(s.toLowerCase())
      ))
      .sort((a, b) => b.priority - a.priority)
      .slice(0, 20);

   // Build learning roadmaps
   const roadmaps = generateLearningRoadmaps(recommendedSkills, studentSkills);

   // Categorize skills
   recommendedSkills.forEach(item => {
      const skill = item.skill;
      if (skill.category === 'technical') {
         skillCategories.technical.skills.push({
            ...skill,
            priority: item.priority,
            sources: item.sources,
            matchReason: getMatchReason(skill, studentSkills, careerRecommendations)
         });
      } else if (skill.category === 'soft') {
         skillCategories.soft.skills.push({
            ...skill,
            priority: item.priority,
            sources: item.sources,
            matchReason: getMatchReason(skill, studentSkills, careerRecommendations)
         });
      } else if (skill.category === 'industry') {
         skillCategories.industry.skills.push({
            ...skill,
            priority: item.priority,
            sources: item.sources,
            matchReason: getMatchReason(skill, studentSkills, careerRecommendations)
         });
      } else if (skill.category === 'certification') {
         skillCategories.certifications.skills.push({
            ...skill,
            priority: item.priority,
            sources: item.sources,
            matchReason: getMatchReason(skill, studentSkills, careerRecommendations)
         });
      }
   });

   // Sort skills within each category by priority
   Object.keys(skillCategories).forEach(key => {
      skillCategories[key].skills.sort((a, b) => b.priority - a.priority);
   });

   // Generate learning resources
   const learningResources = generateLearningResources(recommendedSkills.slice(0, 10));

   // Calculate learning timeline estimates
   const timelineEstimate = calculateTimelineEstimate(recommendedSkills);

   return {
      categories: skillCategories,
      roadmaps: roadmaps,
      resources: learningResources,
      timeline: timelineEstimate,
      totalSkills: recommendedSkills.length,
      skillGaps: recommendedSkills.length,
      existingSkills: studentSkills.length
   };
}

// Skill Database
function getSkillDatabase() {
   return [
      // Technical Skills
      {
         id: 'python',
         name: 'Python Programming',
         category: 'technical',
         level: 'intermediate',
         estimatedTime: '2-3 months',
         description: 'Versatile programming language for data science, AI, and web development',
         resources: ['Python.org', 'Codecademy', 'Coursera Python Specialization'],
         certifications: ['PCEP', 'PCAP']
      },
      {
         id: 'javascript',
         name: 'JavaScript',
         category: 'technical',
         level: 'intermediate',
         estimatedTime: '2-3 months',
         description: 'Core language for web development and interactive applications',
         resources: ['MDN Web Docs', 'freeCodeCamp', 'JavaScript.info'],
         certifications: ['JavaScript Developer Certificate']
      },
      {
         id: 'data-analysis',
         name: 'Data Analysis',
         category: 'technical',
         level: 'intermediate',
         estimatedTime: '3-4 months',
         description: 'Statistical analysis and data interpretation using tools like Python, R, or Excel',
         resources: ['DataCamp', 'Kaggle', 'Google Data Analytics Certificate'],
         certifications: ['Google Data Analytics', 'IBM Data Science']
      },
      {
         id: 'machine-learning',
         name: 'Machine Learning',
         category: 'technical',
         level: 'advanced',
         estimatedTime: '4-6 months',
         description: 'Algorithms and statistical models for predictive analytics',
         resources: ['Coursera ML', 'Fast.ai', 'Stanford CS229'],
         certifications: ['TensorFlow Developer', 'AWS ML Specialty']
      },
      {
         id: 'web-development',
         name: 'Web Development',
         category: 'technical',
         level: 'beginner',
         estimatedTime: '3-4 months',
         description: 'Building websites and web applications using HTML, CSS, and JavaScript',
         resources: ['The Odin Project', 'freeCodeCamp', 'MDN'],
         certifications: ['Responsive Web Design', 'Front End Development']
      },
      {
         id: 'sql',
         name: 'SQL',
         category: 'technical',
         level: 'beginner',
         estimatedTime: '1-2 months',
         description: 'Database query language for data management and analysis',
         resources: ['SQLZoo', 'W3Schools SQL', 'Mode Analytics'],
         certifications: ['Microsoft SQL Server', 'Oracle SQL']
      },
      {
         id: 'cloud-computing',
         name: 'Cloud Computing',
         category: 'technical',
         level: 'intermediate',
         estimatedTime: '3-5 months',
         description: 'Cloud platforms and services (AWS, Azure, GCP)',
         resources: ['AWS Training', 'Azure Learning', 'Google Cloud Training'],
         certifications: ['AWS Certified', 'Azure Fundamentals', 'GCP Associate']
      },
      {
         id: 'cybersecurity',
         name: 'Cybersecurity',
         category: 'technical',
         level: 'advanced',
         estimatedTime: '4-6 months',
         description: 'Security principles, threat detection, and risk management',
         resources: ['Cybrary', 'SANS Training', 'CompTIA Security+'],
         certifications: ['CompTIA Security+', 'CISSP', 'CEH']
      },
      // Soft Skills
      {
         id: 'communication',
         name: 'Communication',
         category: 'soft',
         level: 'beginner',
         estimatedTime: '1-2 months',
         description: 'Effective verbal and written communication in professional settings',
         resources: ['Toastmasters', 'Coursera Communication', 'LinkedIn Learning'],
         certifications: ['Professional Communication Certificate']
      },
      {
         id: 'leadership',
         name: 'Leadership',
         category: 'soft',
         level: 'intermediate',
         estimatedTime: '3-6 months',
         description: 'Team management, strategic thinking, and organizational leadership',
         resources: ['Harvard Business Review', 'Coursera Leadership', 'LinkedIn Learning'],
         certifications: ['Project Management', 'Leadership Certificate']
      },
      {
         id: 'teamwork',
         name: 'Teamwork',
         category: 'soft',
         level: 'beginner',
         estimatedTime: '1-2 months',
         description: 'Collaboration, conflict resolution, and team dynamics',
         resources: ['Team Building Activities', 'Online Collaboration Tools', 'Workshops'],
         certifications: ['Team Collaboration Certificate']
      },
      {
         id: 'problem-solving',
         name: 'Problem Solving',
         category: 'soft',
         level: 'intermediate',
         estimatedTime: '2-3 months',
         description: 'Analytical thinking, creative solutions, and decision-making',
         resources: ['Design Thinking', 'Systems Thinking', 'Problem Solving Courses'],
         certifications: ['Design Thinking Certificate']
      },
      {
         id: 'public-speaking',
         name: 'Public Speaking',
         category: 'soft',
         level: 'intermediate',
         estimatedTime: '2-3 months',
         description: 'Presenting ideas effectively to individuals and groups',
         resources: ['Toastmasters', 'Presentation Skills Courses', 'Practice Groups'],
         certifications: ['Public Speaking Certificate']
      },
      // Industry Skills
      {
         id: 'business-acumen',
         name: 'Business Acumen',
         category: 'industry',
         level: 'intermediate',
         estimatedTime: '3-4 months',
         description: 'Understanding business operations, strategy, and management',
         resources: ['Business Case Studies', 'Coursera Business', 'Harvard Business Review'],
         certifications: ['Business Management Certificate']
      },
      {
         id: 'entrepreneurship',
         name: 'Entrepreneurship',
         category: 'industry',
         level: 'intermediate',
         estimatedTime: '4-6 months',
         description: 'Startup development, business planning, and venture management',
         resources: ['Y Combinator Startup School', 'Stanford eCorner', 'MIT Entrepreneurship'],
         certifications: ['Entrepreneurship Certificate']
      },
      {
         id: 'project-management',
         name: 'Project Management',
         category: 'industry',
         level: 'intermediate',
         estimatedTime: '3-4 months',
         description: 'Project planning, execution, and management methodologies',
         resources: ['PMI Training', 'Agile Alliance', 'Scrum Alliance'],
         certifications: ['PMP', 'Agile Certified Practitioner', 'Scrum Master']
      },
      {
         id: 'data-science',
         name: 'Data Science',
         category: 'industry',
         level: 'advanced',
         estimatedTime: '6-8 months',
         description: 'Advanced analytics, predictive modeling, and data-driven decision making',
         resources: ['Kaggle Competitions', 'Data Science Courses', 'Research Papers'],
         certifications: ['IBM Data Science', 'Google Data Analytics']
      },
      {
         id: 'digital-marketing',
         name: 'Digital Marketing',
         category: 'industry',
         level: 'intermediate',
         estimatedTime: '3-4 months',
         description: 'Online marketing strategies, SEO, and social media management',
         resources: ['Google Digital Garage', 'HubSpot Academy', 'Coursera Marketing'],
         certifications: ['Google Ads', 'HubSpot Inbound Marketing']
      },
      // Certifications
      {
         id: 'aws-certified',
         name: 'AWS Certified Solutions Architect',
         category: 'certification',
         level: 'advanced',
         estimatedTime: '3-4 months',
         description: 'Professional certification for cloud architecture and AWS services',
         resources: ['AWS Training', 'A Cloud Guru', 'Stephane Maarek Course'],
         certifications: ['AWS Certified Solutions Architect']
      },
      {
         id: 'google-analytics',
         name: 'Google Analytics Certification',
         category: 'certification',
         level: 'intermediate',
         estimatedTime: '1-2 months',
         description: 'Web analytics and digital marketing measurement',
         resources: ['Google Analytics Academy', 'Skillshop', 'Practice Tests'],
         certifications: ['Google Analytics Individual Qualification']
      },
      {
         id: 'compTIA-security',
         name: 'CompTIA Security+',
         category: 'certification',
         level: 'intermediate',
         estimatedTime: '2-3 months',
         description: 'Entry-level cybersecurity certification',
         resources: ['CompTIA Training', 'Professor Messer', 'Practice Exams'],
         certifications: ['CompTIA Security+']
      },
      {
         id: 'google-data-analytics',
         name: 'Google Data Analytics Professional Certificate',
         category: 'certification',
         level: 'intermediate',
         estimatedTime: '3-4 months',
         description: 'Professional certification for data analysis and visualization',
         resources: ['Coursera', 'Google Data Analytics Program', 'Case Studies'],
         certifications: ['Google Data Analytics Professional']
      }
   ];
}

function findSkillInDatabase(skillName, database) {
   return database.find(s =>
      s.name.toLowerCase().includes(skillName.toLowerCase()) ||
      skillName.toLowerCase().includes(s.name.toLowerCase())
   );
}

function calculateSkillPriority(skillInfo, existingSkills, career = null, course = null) {
   let priority = 50;

   // Boost priority based on career relevance
   if (career) {
      const careerRequiredSkills = career.requiredSkills || [];
      if (careerRequiredSkills.some(s =>
         s.toLowerCase().includes(skillInfo.name.toLowerCase()) ||
         skillInfo.name.toLowerCase().includes(s.toLowerCase())
      )) {
         priority += 30;
      }
   }

   // Boost priority based on course relevance
   if (course) {
      const courseRequiredSkills = course.requiredSkills || [];
      if (courseRequiredSkills.some(s =>
         s.toLowerCase().includes(skillInfo.name.toLowerCase()) ||
         skillInfo.name.toLowerCase().includes(s.toLowerCase())
      )) {
         priority += 20;
      }
   }

   // Higher priority for advanced skills
   if (skillInfo.level === 'advanced') priority += 10;
   if (skillInfo.level === 'intermediate') priority += 5;

   // Lower priority if student already has related skills
   existingSkills.forEach(skill => {
      if (skill.toLowerCase().includes(skillInfo.name.toLowerCase().split(' ')[0]) ||
         skillInfo.name.toLowerCase().includes(skill.toLowerCase().split(' ')[0])) {
         priority -= 10;
      }
   });

   return Math.max(0, Math.min(100, priority));
}

function getIndustrySkills(interest) {
   const industryMap = {
      'technology': ['Python', 'JavaScript', 'Cloud Computing', 'Cybersecurity', 'Data Analysis'],
      'business': ['Business Acumen', 'Digital Marketing', 'Project Management', 'Leadership', 'Communication'],
      'medicine': ['Healthcare Management', 'Medical Terminology', 'Patient Care', 'Data Analysis'],
      'law': ['Legal Research', 'Contract Law', 'Communication', 'Critical Thinking'],
      'engineering': ['Project Management', 'CAD', 'Systems Thinking', 'Problem Solving'],
      'education': ['Instructional Design', 'Communication', 'Leadership', 'Curriculum Development'],
      'arts': ['Creative Design', 'Digital Marketing', 'Communication', 'Project Management'],
      'sports': ['Sports Management', 'Leadership', 'Communication', 'Teamwork'],
      'media': ['Digital Marketing', 'Content Creation', 'Communication', 'Design'],
      'agriculture': ['Agricultural Science', 'Data Analysis', 'Project Management', 'Business Acumen']
   };

   const skills = industryMap[interest.toLowerCase()] || [];
   return skills.map(skill => {
      const db = getSkillDatabase();
      const found = db.find(s => s.name.includes(skill));
      return found ? found.name : skill;
   });
}

function getMatchReason(skill, existingSkills, careers) {
   const reasons = [];

   // Check if skill is recommended by careers
   if (careers && careers.length > 0) {
      const matchingCareers = careers.filter(c =>
         (c.requiredSkills || []).some(s =>
            s.toLowerCase().includes(skill.name.toLowerCase())
         )
      );
      if (matchingCareers.length > 0) {
         reasons.push(`Recommended for ${matchingCareers.slice(0, 2).map(c => c.name).join(', ')}`);
      }
   }

   // Check if skill is a gap
   if (!existingSkills.some(s => s.toLowerCase().includes(skill.name.toLowerCase().split(' ')[0]))) {
      reasons.push('Addresses a skill gap');
   }

   return reasons.length > 0 ? reasons.join('. ') : 'Recommended for career development';
}

function generateLearningRoadmaps(recommendedSkills, existingSkills) {
   const roadmaps = {
      beginner: {
         title: 'Beginner Roadmap',
         description: 'Start your learning journey with foundational skills',
         skills: []
      },
      intermediate: {
         title: 'Intermediate Roadmap',
         description: 'Build on your foundation with advanced concepts',
         skills: []
      },
      advanced: {
         title: 'Advanced Roadmap',
         description: 'Master complex skills and industry best practices',
         skills: []
      }
   };

   // Categorize skills by level
   recommendedSkills.forEach(item => {
      const skill = item.skill;
      if (skill.level === 'beginner') {
         roadmaps.beginner.skills.push({
            ...skill,
            priority: item.priority
         });
      } else if (skill.level === 'intermediate') {
         roadmaps.intermediate.skills.push({
            ...skill,
            priority: item.priority
         });
      } else if (skill.level === 'advanced') {
         roadmaps.advanced.skills.push({
            ...skill,
            priority: item.priority
         });
      }
   });

   // Sort skills within each roadmap by priority
   Object.keys(roadmaps).forEach(key => {
      roadmaps[key].skills.sort((a, b) => b.priority - a.priority);
   });

   return roadmaps;
}

function generateLearningResources(recommendedSkills) {
   const resources = [];

   recommendedSkills.forEach(skill => {
      if (skill.skill.resources) {
         skill.skill.resources.forEach(resource => {
            if (!resources.some(r => r.name === resource)) {
               resources.push({
                  name: resource,
                  category: skill.skill.category,
                  skillName: skill.skill.name,
                  type: getResourceType(resource),
                  priority: skill.priority
               });
            }
         });
      }
   });

   // Sort resources by priority
   resources.sort((a, b) => b.priority - a.priority);

   return resources.slice(0, 15);
}

function getResourceType(resource) {
   const types = {
      'Codecademy': 'Online Course',
      'Coursera': 'Online Course',
      'edX': 'Online Course',
      'DataCamp': 'Online Course',
      'Kaggle': 'Practice Platform',
      'freeCodeCamp': 'Online Course',
      'MDN': 'Documentation',
      'W3Schools': 'Documentation',
      'YouTube': 'Video Tutorial',
      'LinkedIn Learning': 'Online Course',
      'Toasmasters': 'Workshop',
      'Harvard Business Review': 'Reading Material',
      'AWS Training': 'Official Training',
      'PMI Training': 'Official Training'
   };

   for (const [key, value] of Object.entries(types)) {
      if (resource.includes(key)) {
         return value;
      }
   }
   return 'Learning Resource';
}

function calculateTimelineEstimate(recommendedSkills) {
   const skillCount = recommendedSkills.length;
   const totalMonths = recommendedSkills.reduce((total, skill) => {
      const months = parseInt(skill.skill.estimatedTime);
      return total + (isNaN(months) ? 2 : months);
   }, 0);

   return {
      totalMonths: totalMonths,
      estimatedWeeks: Math.round((totalMonths / skillCount) * 4),
      skillCount: skillCount,
      breakdown: {
         beginner: recommendedSkills.filter(s => s.skill.level === 'beginner').length,
         intermediate: recommendedSkills.filter(s => s.skill.level === 'intermediate').length,
         advanced: recommendedSkills.filter(s => s.skill.level === 'advanced').length
      }
   };
}

// Clear assessment data
app.get('/clear-assessment', (req, res) => {
   req.session.assessmentData = {};
   req.session.recommendations = null;
   req.session.studentData = null;
   res.redirect('/assessment');
});

// ============================================
// ERROR HANDLING
// ============================================

app.use((req, res) => {
   res.status(404).render('index', {
      error: 'Page not found',
      message: 'The page you are looking for does not exist.'
   });
});

// ============================================
// START SERVER
// ============================================

app.listen(PORT, () => {
   console.log(`🚀 AI Career Predictor running on http://localhost:${PORT}`)
   console.log(`📁 Environment: ${process.env.NODE_ENV || 'development'}`);
});

module.exports = app;