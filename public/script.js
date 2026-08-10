// ============================================
// AI Career Predictor - Client Side JavaScript
// ============================================

// ============================================
// Navigation Mobile Toggle
// ============================================

document.addEventListener('DOMContentLoaded', function () {
   const navToggle = document.querySelector('.nav-toggle');
   const navLinks = document.querySelector('.nav-links');

   if (navToggle && navLinks) {
      navToggle.addEventListener('click', function () {
         const isExpanded = navToggle.getAttribute('aria-expanded') === 'true';
         navToggle.setAttribute('aria-expanded', !isExpanded);
         navLinks.classList.toggle('open');
      });
   }

   // Close mobile menu on link click
   document.querySelectorAll('.nav-links a').forEach(link => {
      link.addEventListener('click', () => {
         if (navLinks.classList.contains('open')) {
            navLinks.classList.remove('open');
            navToggle.setAttribute('aria-expanded', 'false');
         }
      });
   });

   // Close mobile menu on outside click
   document.addEventListener('click', (e) => {
      if (navLinks && navLinks.classList.contains('open')) {
         if (!e.target.closest('.navbar')) {
            navLinks.classList.remove('open');
            navToggle.setAttribute('aria-expanded', 'false');
         }
      }
   });
});

// ============================================
// Animated Counter for Statistics
// ============================================

function animateCounters() {
   const counters = document.querySelectorAll('.stat-number[data-target]');

   if (!counters.length) return;

   counters.forEach(counter => {
      const target = parseInt(counter.getAttribute('data-target'));
      const duration = 2000;
      const step = Math.max(1, Math.floor(target / 60));
      let current = 0;

      const updateCounter = () => {
         current += step;
         if (current >= target) {
            counter.textContent = target;
            return;
         }
         counter.textContent = current;
         requestAnimationFrame(updateCounter);
      };

      // Start animation when element is visible
      const observer = new IntersectionObserver((entries) => {
         entries.forEach(entry => {
            if (entry.isIntersecting) {
               updateCounter();
               observer.disconnect();
            }
         });
      }, { threshold: 0.5 });

      observer.observe(counter);
   });
}

// ============================================
// Assessment Form - Multi-step
// ============================================

let currentStep = 1;
const totalSteps = 7;

// Initialize form on page load
document.addEventListener('DOMContentLoaded', function () {
   initAssessmentForm();
});

function initAssessmentForm() {
   const form = document.getElementById('assessmentForm');
   if (!form) return;

   // Show initial step
   showStep(1);

   // Form submission
   form.addEventListener('submit', function (e) {
      // Validate all steps before final submission
      let allValid = true;
      for (let i = 1; i <= totalSteps; i++) {
         if (!validateStep(i)) {
            allValid = false;
            showStep(i);
            break;
         }
      }

      if (!allValid) {
         e.preventDefault();
         return;
      }

      // Allow form to submit normally
      const submitBtn = form.querySelector('button[type="submit"]');
      if (submitBtn) {
         submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Submitting...';
         submitBtn.disabled = true;
      }
   });

   // Handle hash on load
   const hash = window.location.hash;
   if (hash) {
      const stepMatch = hash.match(/step-(\d+)/);
      if (stepMatch) {
         const step = parseInt(stepMatch[1]);
         if (step >= 1 && step <= totalSteps) {
            showStep(step);
         }
      }
   }
}

// Show a specific step
function showStep(step) {
   // Hide all steps
   document.querySelectorAll('.form-step').forEach(el => {
      el.classList.remove('active');
   });

   // Show target step
   const targetStep = document.querySelector(`.form-step[data-step="${step}"]`);
   if (targetStep) {
      targetStep.classList.add('active');
   }

   // Update current step
   currentStep = step;
   const currentStepInput = document.getElementById('currentStep');
   if (currentStepInput) {
      currentStepInput.value = step;
   }

   // Update progress
   updateProgress();

   // Update URL hash
   window.location.hash = `step-${step}`;

   // Scroll to top of form
   const formContainer = document.querySelector('.form-container');
   if (formContainer) {
      formContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
   }
}

// Update progress bar
function updateProgress() {
   const progress = ((currentStep - 1) / (totalSteps - 1)) * 100;
   const progressFill = document.getElementById('progressFill');
   if (progressFill) {
      progressFill.style.width = progress + '%';
   }

   // Update step indicators
   document.querySelectorAll('.step-indicator').forEach((indicator, index) => {
      const step = index + 1;
      indicator.classList.toggle('active', step <= currentStep);
      indicator.classList.toggle('completed', step < currentStep);
   });
}

// Next step function (global for onclick)
window.nextStep = function () {
   if (currentStep < totalSteps) {
      // Validate current step before proceeding
      if (validateStep(currentStep)) {
         showStep(currentStep + 1);
      }
   }
};

// Previous step function (global for onclick)
window.prevStep = function () {
   if (currentStep > 1) {
      showStep(currentStep - 1);
   }
};

// Validate a specific step
function validateStep(step) {
   const stepElement = document.querySelector(`.form-step[data-step="${step}"]`);
   if (!stepElement) return true;

   // Find all required inputs in this step
   const requiredInputs = stepElement.querySelectorAll('[required]');
   let isValid = true;
   let firstError = null;

   requiredInputs.forEach(input => {
      // Remove existing error state
      input.classList.remove('error');

      // Skip if input is hidden
      if (input.type === 'hidden') return;

      // Check for checkbox/radio groups
      if (input.type === 'checkbox' || input.type === 'radio') {
         const name = input.name;
         const group = stepElement.querySelectorAll(`input[name="${name}"]`);
         const isChecked = Array.from(group).some(el => el.checked);

         if (!isChecked) {
            isValid = false;
            if (!firstError) firstError = input;
            input.classList.add('error');
         }
      } else if (!input.value || input.value.trim() === '') {
         isValid = false;
         if (!firstError) firstError = input;
         input.classList.add('error');
      }
   });

   if (!isValid) {
      showNotification('Please fill in all required fields', 'error');
      if (firstError) {
         firstError.focus();
      }
   }

   return isValid;
}

// ============================================
// Keyboard Navigation
// ============================================

document.addEventListener('keydown', function (e) {
   // Alt + Arrow Right for next step
   if (e.altKey && e.key === 'ArrowRight') {
      e.preventDefault();
      if (typeof window.nextStep === 'function') window.nextStep();
   }
   // Alt + Arrow Left for previous step
   if (e.altKey && e.key === 'ArrowLeft') {
      e.preventDefault();
      if (typeof window.prevStep === 'function') window.prevStep();
   }
});

// ============================================
// Auto-save progress
// ============================================

let autoSaveTimeout;

function autoSaveProgress() {
   clearTimeout(autoSaveTimeout);
   autoSaveTimeout = setTimeout(() => {
      const form = document.getElementById('assessmentForm');
      if (form) {
         const formData = new FormData(form);
         // Save to sessionStorage
         const data = {};
         formData.forEach((value, key) => {
            data[key] = value;
         });
         sessionStorage.setItem('assessmentProgress', JSON.stringify(data));
         console.log('Progress auto-saved');
      }
   }, 3000);
}

// Add auto-save on input change
document.addEventListener('input', function (e) {
   if (e.target.closest('#assessmentForm')) {
      autoSaveProgress();
   }
});

// ============================================
// Notification System
// ============================================

function showNotification(message, type = 'info') {
   // Remove existing notifications
   const existing = document.querySelector('.notification-toast');
   if (existing) existing.remove();

   const notification = document.createElement('div');
   notification.className = `notification-toast notification-${type}`;
   notification.innerHTML = `
        <div class="notification-content">
            <i class="fas ${type === 'success' ? 'fa-check-circle' : type === 'error' ? 'fa-exclamation-circle' : 'fa-info-circle'}"></i>
            <span>${message}</span>
        </div>
        <button class="notification-close" onclick="this.parentElement.remove()"><i class="fas fa-times"></i></button>
    `;

   // Add styles dynamically
   const styles = {
      position: 'fixed',
      top: '20px',
      right: '20px',
      zIndex: '9999',
      padding: '16px 24px',
      borderRadius: '12px',
      background: 'white',
      boxShadow: '0 10px 40px rgba(0,0,0,0.2)',
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      maxWidth: '400px',
      animation: 'slideInRight 0.3s ease',
      borderLeft: `4px solid ${type === 'success' ? '#22c55e' : type === 'error' ? '#ef4444' : '#6366f1'}`
   };

   Object.assign(notification.style, styles);

   document.body.appendChild(notification);

   // Auto remove after 5 seconds
   setTimeout(() => {
      if (notification.parentNode) {
         notification.remove();
      }
   }, 5000);
}

// ============================================
// Add Notification Styles
// ============================================

(function addNotificationStyles() {
   const style = document.createElement('style');
   style.textContent = `
        @keyframes slideInRight {
            from {
                transform: translateX(100%);
                opacity: 0;
            }
            to {
                transform: translateX(0);
                opacity: 1;
            }
        }
        
        .notification-toast {
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 9999;
            padding: 16px 24px;
            border-radius: 12px;
            background: white;
            box-shadow: 0 10px 40px rgba(0,0,0,0.2);
            display: flex;
            align-items: center;
            gap: 12px;
            max-width: 400px;
            animation: slideInRight 0.3s ease;
        }
        
        .notification-success {
            border-left: 4px solid #22c55e;
        }
        .notification-error {
            border-left: 4px solid #ef4444;
        }
        .notification-info {
            border-left: 4px solid #6366f1;
        }
        
        .notification-content {
            display: flex;
            align-items: center;
            gap: 8px;
            flex: 1;
        }
        
        .notification-content i {
            font-size: 20px;
        }
        
        .notification-success .notification-content i {
            color: #22c55e;
        }
        .notification-error .notification-content i {
            color: #ef4444;
        }
        .notification-info .notification-content i {
            color: #6366f1;
        }
        
        .notification-close {
            background: none;
            border: none;
            cursor: pointer;
            color: #9ca3af;
            padding: 4px;
            font-size: 16px;
        }
        .notification-close:hover {
            color: #4b5563;
        }
        
        .form-group input.error,
        .form-group select.error,
        .form-group textarea.error {
            border-color: #ef4444;
            box-shadow: 0 0 0 4px rgba(239, 68, 68, 0.1);
        }
        
        .step-indicator.completed {
            background: #22c55e;
            color: white;
        }
    `;
   document.head.appendChild(style);
})();

// ============================================
// Smooth Scrolling for Anchor Links
// ============================================

function initSmoothScroll() {
   document.querySelectorAll('a[href^="#"]').forEach(anchor => {
      anchor.addEventListener('click', function (e) {
         const targetId = this.getAttribute('href');
         if (targetId === '#') return;

         const target = document.querySelector(targetId);
         if (target) {
            e.preventDefault();
            target.scrollIntoView({
               behavior: 'smooth',
               block: 'start'
            });
         }
      });
   });
}

// ============================================
// Form Input Validation (real-time)
// ============================================

function initFormValidation() {
   document.querySelectorAll('.form-group input, .form-group select, .form-group textarea').forEach(input => {
      input.addEventListener('blur', function () {
         if (this.hasAttribute('required') && !this.value.trim()) {
            this.classList.add('error');
         } else {
            this.classList.remove('error');
         }
      });

      input.addEventListener('input', function () {
         if (this.value.trim()) {
            this.classList.remove('error');
         }
      });
   });
}

// ============================================
// Toggle Explanations
// ============================================

function toggleExplanations(button) {
   const content = button.nextElementSibling;
   const isHidden = content.style.display === 'none' || !content.style.display;

   if (isHidden) {
      content.style.display = 'block';
      content.style.animation = 'slideDown 0.3s ease';
      button.innerHTML = '<i class="fas fa-chevron-up"></i> Hide explanation';
   } else {
      content.style.animation = 'slideUp 0.3s ease';
      setTimeout(() => {
         content.style.display = 'none';
      }, 300);
      button.innerHTML = '<i class="fas fa-info-circle"></i> Why this?';
   }
}

// Add explanation animation styles
(function addExplanationStyles() {
   const style = document.createElement('style');
   style.textContent = `
        @keyframes slideDown {
            from {
                opacity: 0;
                max-height: 0;
                transform: translateY(-10px);
            }
            to {
                opacity: 1;
                max-height: 500px;
                transform: translateY(0);
            }
        }
        
        @keyframes slideUp {
            from {
                opacity: 1;
                max-height: 500px;
                transform: translateY(0);
            }
            to {
                opacity: 0;
                max-height: 0;
                transform: translateY(-10px);
            }
        }
        
        .explanation-content {
            overflow: hidden;
            transition: all 0.3s ease;
        }
    `;
   document.head.appendChild(style);
})();

// ============================================
// Initialize All Functions
// ============================================

document.addEventListener('DOMContentLoaded', function () {
   initSmoothScroll();
   initFormValidation();
   animateCounters();

   // Add active class to current nav link
   const currentPath = window.location.pathname;
   document.querySelectorAll('.nav-links a').forEach(link => {
      if (link.getAttribute('href') === currentPath) {
         link.classList.add('active');
      }
   });

   // Restore saved progress if exists
   const savedProgress = sessionStorage.getItem('assessmentProgress');
   if (savedProgress) {
      try {
         const data = JSON.parse(savedProgress);
         const form = document.getElementById('assessmentForm');
         if (form) {
            Object.keys(data).forEach(key => {
               const input = form.querySelector(`[name="${key}"]`);
               if (input) {
                  if (input.type === 'checkbox' || input.type === 'radio') {
                     if (data[key] === input.value) {
                        input.checked = true;
                     }
                  } else {
                     input.value = data[key];
                  }
               }
            });
         }
      } catch (e) {
         console.log('Could not restore saved progress');
      }
   }
});

// ============================================
// Utility Functions
// ============================================

function debounce(func, wait) {
   let timeout;
   return function executedFunction(...args) {
      const later = () => {
         clearTimeout(timeout);
         func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
   };
}

function formatDate(date) {
   return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
   });
}

// ============================================
// Export for testing (if needed)
// ============================================

if (typeof module !== 'undefined' && module.exports) {
   module.exports = {
      showNotification,
      debounce,
      formatDate,
      validateStep,
      showStep
   };
}