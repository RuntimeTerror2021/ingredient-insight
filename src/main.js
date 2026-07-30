/*
==============================================
INGREDIENT INSIGHT - REDESIGNED JAVASCRIPT
==============================================
Modern, performant interactions and animations

TABLE OF CONTENTS:
1. DOM Content Loaded Event
2. Navigation & Mobile Menu
3. Scroll Effects & Animations
4. Hero Section Effects
5. Intersection Observer
6. Utility Functions
==============================================
*/

import {animate, inView, stagger, scroll} from "motion"
import { app } from './firebase-config.js';
import { getFirestore, collection, addDoc, serverTimestamp } from 'firebase/firestore';

const db = getFirestore(app);

// =========== 1. DOM Content Loaded Event ===========
document.addEventListener('DOMContentLoaded', function() {
    initializeNavigation();
    initializeScrollEffects();
    initializeHeroEffects();
    initializeScrollAnimations();
    initializeWaitlist();
});

// =========== 2. Navigation & Mobile Menu ===========
function initializeNavigation() {
    const hamburger = document.getElementById('hamburger');
    const navMenu = document.getElementById('navMenu');
    const navLinks = document.querySelectorAll('.nav-link');
    const navbar = document.getElementById('navbar');

    // Mobile menu toggle functionality
    if (hamburger && navMenu) {
        hamburger.addEventListener('click', function() {
            hamburger.classList.toggle('active');
            navMenu.classList.toggle('active');
            document.body.style.overflow = hamburger.classList.contains('active') ? 'hidden' : '';

            // Update ARIA attributes for accessibility
            const isExpanded = hamburger.classList.contains('active');
            hamburger.setAttribute('aria-expanded', isExpanded.toString());
        });

        // Close mobile menu when clicking on nav links
        navLinks.forEach(link => {
            link.addEventListener('click', function() {
                hamburger.classList.remove('active');
                navMenu.classList.remove('active');
                document.body.style.overflow = '';
                hamburger.setAttribute('aria-expanded', 'false');
            });
        });

        // Close mobile menu when clicking outside
        document.addEventListener('click', function(e) {
            if (!hamburger.contains(e.target) && !navMenu.contains(e.target)) {
                hamburger.classList.remove('active');
                navMenu.classList.remove('active');
                document.body.style.overflow = '';
                hamburger.setAttribute('aria-expanded', 'false');
            }
        });
    }

    // Active navigation link highlighting
    function updateActiveNavLink() {
        const sections = document.querySelectorAll('section[id]');
        const scrollPosition = window.scrollY + 100;

        sections.forEach(section => {
            const sectionTop = section.offsetTop;
            const sectionHeight = section.clientHeight;
            const sectionId = section.getAttribute('id');
            const correspondingLink = document.querySelector(`.nav-link[href="#${sectionId}"]`);

            if (scrollPosition >= sectionTop && scrollPosition < sectionTop + sectionHeight) {
                navLinks.forEach(link => link.classList.remove('active'));
                if (correspondingLink) {
                    correspondingLink.classList.add('active');
                }
            }
        });
    }

    // Update active link on scroll
    window.addEventListener('scroll', debounce(updateActiveNavLink, 10));
}

// =========== 3. Scroll Effects & Animations ===========
function initializeScrollEffects() {
    const navbar = document.getElementById('navbar');
    let lastScroll = 0;

    window.addEventListener('scroll', debounce(function() {
        const scrollTop = document.documentElement.scrollTop;

        // Add scrolled class to navbar for styling
        if (scrollTop > 50) {
            navbar.classList.add('scrolled');
        } else {
            navbar.classList.remove('scrolled');
        }

        // Hide on scroll down, show on scroll up
        if (scrollTop > lastScroll && scrollTop > 80) {
            navbar.classList.add('nav-hidden');
        } else {
            navbar.classList.remove('nav-hidden');
        }
        lastScroll = scrollTop;
    }, 10));
}

// =========== 4. Hero Section Effects ===========
function initializeHeroEffects() {
    // Animated counter for stats
    function animateCounters() {
        const counters = document.querySelectorAll('.stat-number');

        counters.forEach(counter => {
            const target = parseInt(counter.getAttribute('data-target'));
            const increment = target / 100;
            let current = 0;

            const updateCounter = () => {
                if (current < target) {
                    current += increment;
                    counter.textContent = Math.ceil(current).toLocaleString();
                    setTimeout(updateCounter, 20);
                } else {
                    counter.textContent = target.toLocaleString();
                }
            };

            updateCounter();
        });
    }

    // Trigger counter animation when hero section is visible
    const heroSection = document.getElementById('home');
    if (heroSection) {
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    setTimeout(animateCounters, 500);
                    observer.unobserve(entry.target);
                }
            });
        }, { threshold: 0.5 });

        observer.observe(heroSection);
    }
}

// =========== 5. Intersection Observer for Scroll Animations ===========
function initializeScrollAnimations() {
    // Elements to animate on scroll
    const animateElements = document.querySelectorAll('.scroll-animate');

    // Intersection Observer options
    const observerOptions = {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px'
    };

    // Create observer
    const observer = new IntersectionObserver(function(entries) {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('in-view');

                // Add staggered animation for grid items
                if (entry.target.parentElement.classList.contains('features-grid') ||
                    entry.target.parentElement.classList.contains('testimonials-grid')) {

                    const siblings = Array.from(entry.target.parentElement.children);
                    const index = siblings.indexOf(entry.target);
                    entry.target.style.transitionDelay = `${index * 0.1}s`;
                }

                // Unobserve after animation
                observer.unobserve(entry.target);
            }
        });
    }, observerOptions);

    // Observe all elements
    animateElements.forEach(element => {
        observer.observe(element);
    });
}

// =========== 6. Utility Functions ===========

// Debounce function for performance optimization
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

// Smooth scrolling for anchor links
document.addEventListener('click', function(e) {
    const target = e.target.closest('a[href^="#"]');
    if (target && target.getAttribute('href') !== '#') {
        e.preventDefault();
        const targetId = target.getAttribute('href');
        const targetElement = document.querySelector(targetId);

        if (targetElement) {
            const offsetTop = targetElement.offsetTop - 80; // Account for fixed navbar
            window.scrollTo({
                top: offsetTop,
                behavior: 'smooth'
            });
        }
    }
});

// Accessibility: Skip link functionality
const skipLink = document.querySelector('.skip-link');
if (skipLink) {
    skipLink.addEventListener('focus', function() {
        this.style.top = '6px';
    });

    skipLink.addEventListener('blur', function() {
        this.style.top = '-40px';
    });

    skipLink.addEventListener('click', function(e) {
        e.preventDefault();
        const target = document.querySelector(this.getAttribute('href'));
        if (target) {
            target.focus();
            target.scrollIntoView({ behavior: 'smooth' });
        }
    });
}

// Keyboard navigation support
document.addEventListener('keydown', function(e) {
    // Escape key closes mobile menu
    if (e.key === 'Escape') {
        const hamburger = document.getElementById('hamburger');
        const navMenu = document.getElementById('navMenu');
        if (hamburger && navMenu && navMenu.classList.contains('active')) {
            hamburger.classList.remove('active');
            navMenu.classList.remove('active');
            document.body.style.overflow = '';
            hamburger.setAttribute('aria-expanded', 'false');
        }
    }
});

// Error handling for images
document.addEventListener('error', function(e) {
    if (e.target.tagName === 'IMG') {
        e.target.style.display = 'none';
        console.warn('Image failed to load:', e.target.src);
    }
}, true);
//
// // Performance monitoring
// window.addEventListener('load', function() {
//     // Log performance metrics
//     if (window.performance && window.performance.timing) {
//         const loadTime = window.performance.timing.loadEventEnd - window.performance.timing.navigationStart;
//         console.log(`Page load time: ${loadTime}ms`);
//     }
// });

// Analytics tracking (replace with your analytics code)
function trackEvent(category, action, label) {
    // Google Analytics 4 example:
    // gtag('event', action, {
    //     event_category: category,
    //     event_label: label
    // });

    console.log(`Analytics: ${category} - ${action} - ${label}`);
}

// Track important user interactions
document.addEventListener('click', function(e) {
    const target = e.target.closest('button, a');
    if (target) {
        if (target.classList.contains('btn-primary')) {
            trackEvent('CTA', 'click', 'primary_button');
        } else if (target.classList.contains('btn-secondary')) {
            trackEvent('CTA', 'click', 'secondary_button');
        } else if (target.href && target.href.startsWith('mailto:')) {
            trackEvent('Contact', 'email_click', target.href);
        }
    }
});
//
// const animation = animate('.floating-card',
//     {transform: ['none', 'translateX(200px)']},
//     {ease: 'easeOut',});
//
// scroll(animation);

// Waitlist signup
function initializeWaitlist() {
    const form = document.getElementById('waitlist-form');
    const emailInput = document.getElementById('waitlist-email');
    const messageEl = document.getElementById('waitlist-message');

    if (!form) return;

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const email = emailInput.value.trim();
        if (!email) return;

        messageEl.textContent = '';
        messageEl.className = 'waitlist-message';
        const submitBtn = form.querySelector('button[type="submit"]');
        submitBtn.disabled = true;
        submitBtn.textContent = 'Joining...';

        try {
            await addDoc(collection(db, 'waitlist'), {
                email,
                createdAt: serverTimestamp(),
                source: 'landing-page'
            });

            messageEl.textContent = "You're on the list! We'll be in touch soon.";
            messageEl.classList.add('success');
            emailInput.value = '';
        } catch (error) {
            console.error('Waitlist error:', error);
            messageEl.textContent = 'Something went wrong. Please try again.';
            messageEl.classList.add('error');
        } finally {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i class="fa-solid fa-rocket" aria-hidden="true"></i> Join the Waitlist';
            messageEl.textContent = "";
            messageEl.className = "waitlist-message";
        }
    });
}

