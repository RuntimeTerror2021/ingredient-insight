
/*
 * =============================================================================
 *  INGREDIENT INSIGHT — Application Logic (src/app.js)
 * =============================================================================
 *
 *  This module handles all dashboard functionality for the Ingredient Insight
 *  web app.
 *
 *  ── Table of Contents ───────────────────────────────────────────────────────
 *    1.  Imports & Initialization          (lines  13 –  50)
 *    2.  Utilities                         (lines  53 –  86)
 *    3.  Firestore Helpers                 (lines  89 – 322)
 *         3a. Recipes       users/{uid}/recipes/{spoonacularId}
 *         3b. Grocery Lists users/{uid}/groceryLists/{listId}
 *         3c. Grocery Items users/{uid}/groceryLists/{listId}/items/{itemId}
 *         3d. Meal Plans    users/{uid}/mealPlans/{dateKey}
 *         3e. Saved Foods   users/{uid} → array field `savedFoods`
 *    4.  Auth & Onboarding                 (lines 325 – 646)
 *    5.  Dashboard Tab Switching           (lines 649 – 690)
 *    6.  Search & Ingredient Picker        (lines 693 – 1120)
 *        └─ Filter Modal                   (lines 763 – 1004)
 *    7.  Reader Modal (Article Scraper)    (lines 1126 – 1370)
 *    8.  Recipe Detail Modal               (lines 1373 – 1470)
 *    9.  Profile & Settings                (lines 1473 – 1766)
 *    10. Feedback Form                     (lines 1769 – 1827)
 *    11. Saved Recipes Tab                 (lines 1830 – 1899)
 *    12. Meal Planner                      (lines 1902 – 2072)
 *    13. Grocery List Tab                  (lines 2074 – 2357)
 * =============================================================================
 *
 *  ── Firestore document / collection map ────────────────────────────────────
 *
 *  users/{uid}
 *    User profile document created during onboarding. Contains:
 *    - birthDate, height, weight, goal, dietPrefs, bio (optional)
 *    - savedFoods (array<string>) — quick-add food items for grocery lists
 *    - preferences (map) — notification/personalization/data-sharing toggles
 *    Saved and merged by the onboarding form and profile editor.
 *
 *  users/{uid}/recipes/{spoonacularId}
 *    One document per saved recipe. `spoonacularId` is the numeric Spoonacular
 *    recipe ID coerced to a string for use as the document ID.
 *    - spoonacularId (number), title, image, readyInMinutes, servings, calories
 *    - usedIngredients / missedIngredients (plain-object arrays, serialized)
 *    - sourceUrl (string), savedAt (server timestamp)
 *
 *  users/{uid}/groceryLists/{listId}
 *    auto-generated ID.  name, icon, iconColor, createdAt, updatedAt.
 *
 *  users/{uid}/groceryLists/{listId}/items/{itemId}
 *    auto-generated ID.  name, quantity, category, purchased (bool),
 *    saved (bool), addedAt (server timestamp).
 *
 *  users/{uid}/mealPlans/{dateKey}
 *    dateKey = "YYYY-MM-DD" (string).  date, updatedAt,
 *    meals = { "Breakfast" | "Lunch" | "Dinner" | "Snack": { recipeId, title, image, readyInMinutes, calories } }
 *
 *  feedback
 *    Top-level collection.  type, subject, message, email, uid, timestamp.
 *
 *  ── Spoonacular API ─────────────────────────────────────────────────────────
 *    The SDK key is deobfuscated at init via a character substitution on the
 *    obfuscated key imported from firebase-config.js. Two API instances are
 *    created: ingredientsAPI (autocomplete/mapping) and recipesAPI (search +
 *    info). All SDK calls use the callback pattern:
 *      recipesAPI.method(args..., (error, data, response) => { ... });
 *
 *  ── Key DOM patterns ───────────────────────────────────────────────────────
 *    Tab switching: clicking a sidebar `.page-link` (e.g. class "recipes")
 *    hides all `.dash-tab` sections, then shows `.{class}-tab` (e.g. `.recipes-tab`).
 *    This mapping is handled by pageLinkCallback().
 *
 *    Many tab-scoped IIFEs use their own closures to hold local references
 *    (DOM queries, caches, state) to keep the global scope clean.
 * =============================================================================
 */

// =============================================================================
// 1. IMPORTS & INITIALIZATION
// =============================================================================

import { app as firebase, ak } from './firebase-config.js';
import { getAuth, signOut, onAuthStateChanged, updateProfile } from 'firebase/auth';
import { getFirestore, getDoc, setDoc, doc, addDoc, collection, serverTimestamp, updateDoc, deleteDoc, getDocs, query, orderBy, where, arrayUnion, arrayRemove } from 'firebase/firestore';
import * as Spoonacular from "spoonacular";
import axios from "axios";
import * as cheerio from "cheerio";
import Fuse from 'fuse.js'

const auth = getAuth(firebase);
const db = getFirestore();

/*
 * Spoonacular SDK key deobfuscation.
 * `ak` from firebase-config.js is stored obfuscated; each character matched by
 * the regex /[Lxqs]/g is replaced via the lookup map below.
 */
const defaultClient = Spoonacular.ApiClient.instance;
let aks = defaultClient.authentications['apiKeyScheme'];
aks.apiKey = ak.replace(/[Lxqs]/g, lk5633jfnj => {return{"L":"a","x":"146f3a5ccee","q":"2","s":"5"}[lk5633jfnj]});

const ingredientsAPI = new Spoonacular.IngredientsApi();  // autocompleteIngredientSearch
const recipesAPI = new Spoonacular.RecipesApi();           // searchRecipes, searchRecipesByIngredients, getRecipeInformation

// =============================================================================
// 2. UTILITY FUNCTIONS
// =============================================================================

/*
 * Returns a random integer in [min, max).
 * Used to vary the loading-screen duration on page load.
 */
function getRandomInt(min, max) {
    const minCeiled = Math.ceil(min);
    const maxFloored = Math.floor(max);
    return Math.floor(Math.random() * (maxFloored - minCeiled) + minCeiled);
}

/*
 * Converts an HTML string into a live DOM element / NodeList.
 * Creates a <template>, sets its innerHTML, and returns the child(ren).
 * Equivalent to React's dangerouslySetInnerHTML, used extensively for
 * rendering dynamic cards (search results, recipe cards, grocery items).
 */
function fromHTML(html, trim = true) {
    html = trim ? html.trim() : html;
    if (!html) return null;
    const template = document.createElement('template');
    template.innerHTML = html;
    const result = template.content.children;
    return result.length === 1 ? result[0] : result;
}

// =============================================================================
// 3. FIRESTORE HELPERS
// =============================================================================

const uid = () => auth.currentUser?.uid;

// ── 3a. Saved Recipes ────────────────────────────────────────────────────────
// Collection: users/{uid}/recipes/{spoonacularId}
//   Document ID = Spoonacular recipe ID (number coerced to string).
//   Fields: spoonacularId, title, image, readyInMinutes, servings, calories,
//           usedIngredients (plain-object array), missedIngredients (plain-obj),
//           sourceUrl, savedAt (serverTimestamp)

async function saveRecipe(recipe) {
    if (!uid()) return;
    try {
        await setDoc(doc(db, "users", uid(), "recipes", recipe.id.toString()), {
            spoonacularId: recipe.id,
            title: recipe.title,
            image: recipe.image,
            readyInMinutes: recipe.readyInMinutes || null,
            servings: recipe.servings || null,
            calories: recipe.calories || null,
            usedIngredients: recipe.usedIngredients || [],
            missedIngredients: recipe.missedIngredients || [],
            sourceUrl: recipe.sourceUrl || null,
            savedAt: serverTimestamp()
        });
    } catch (error) {
        console.error("Error saving recipe:", error);
        //TODO: add alert modals + analytics logs
        alert("Error saving recipe. Try again later.")
    }
}

async function unsaveRecipe(recipeId) {
    if (!uid()) return;

    try {
        await deleteDoc(doc(db, "users", uid(), "recipes", String(recipeId)));
    } catch (error) {
        console.error("Error unsaving recipe:", error);
        //TODO: add alert modals + analytics logs
        alert("Error unsaving recipe. Try again later.")
    }
}

async function isRecipeSaved(recipeId) {
    if (!uid()) return false;

    try {
        const snap = await getDoc(doc(db, "users", uid(), "recipes", String(recipeId)));
        return snap.exists();
    } catch (error) {
        console.error("Error checking saved recipe:", error);
        return false;
    }
}

async function getSavedRecipes() {
    if (!uid()) return [];

    try {
        const snap = await getDocs(collection(db, "users", uid(), "recipes"));
        return snap.docs.map(d => d.data());
    } catch (error) {
        console.error("Error getting saved recipes:", error);
        //TODO: modal error + analytics
        return [];
    }
}

// ── 3b. Grocery Lists ───────────────────────────────────────────────────────
// Collection: users/{uid}/groceryLists/{listId}
//   Document ID auto-generated with addDoc.
//   Fields: name, icon (FA class), iconColor (CSS class), createdAt, updatedAt

async function createGroceryList(name, icon, iconColor) {
    if (!uid()) return null;
    try {
        const ref = await addDoc(collection(db, "users", uid(), "groceryLists"), {
            name,
            icon: icon || "fa-basket-shopping",
            iconColor: iconColor || "",
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        });
        return ref.id;
    } catch (error) {
        console.error("Error creating grocery list:", error);
        return null;
    }
}
async function getGroceryLists() {
    if (!uid()) return [];
    try {
        const snap = await getDocs(query(collection(db, "users", uid(), "groceryLists"), orderBy("createdAt", "desc")));
        return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (error) {
        console.error("Error getting grocery lists:", error);
        return [];
    }
}
async function updateGroceryList(listId, data) {
    if (!uid()) return;
    try {
        await updateDoc(doc(db, "users", uid(), "groceryLists", listId), { ...data, updatedAt: serverTimestamp() });
    } catch (error) {
        console.error("Error updating grocery list:", error);
    }
}

async function deleteGroceryList(listId) {
    if (!uid()) return;
    try {
        const itemsSnap = await getDocs(collection(db, "users", uid(), "groceryLists", listId, "items"));
        for (const item of itemsSnap.docs) {
            await deleteDoc(item.ref);
        }
        await deleteDoc(doc(db, "users", uid(), "groceryLists", listId));
    } catch (error) {
        console.error("Error deleting grocery list:", error);
    }
}

// ── 3c. Grocery Items (sub-subcollection) ───────────────────────────────────
// Collection: users/{uid}/groceryLists/{listId}/items/{itemId}
//   auto-generated ID. Fields: name, quantity (string), category (string),
//   purchased (bool), saved (bool), addedAt (serverTimestamp)

async function addGroceryItem(listId, name, quantity, category) {
    if (!uid()) return null;
    try {
        const ref = await addDoc(collection(db, "users", uid(), "groceryLists", listId, "items"), {
            name, quantity: quantity || "1", category: category || "Other", purchased: false, saved: false, addedAt: serverTimestamp()
        });
        return ref.id;
    } catch (error) {
        console.error("Error adding grocery item:", error);
        return null;
    }
}

async function getGroceryItems(listId) {
    if (!uid()) return [];
    try {
        const snap = await getDocs(collection(db, "users", uid(), "groceryLists", listId, "items"));
        return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (error) {
        console.error("Error getting grocery items:", error);
        return [];
    }
}

async function toggleGroceryItemPurchased(listId, itemId, purchased) {
    if (!uid()) return;
    try {
        await updateDoc(doc(db, "users", uid(), "groceryLists", listId, "items", itemId), { purchased });
    } catch (error) {
        console.error("Error toggling grocery item:", error);
    }
}

async function deleteGroceryItem(listId, itemId) {
    if (!uid()) return;
    try {
        await deleteDoc(doc(db, "users", uid(), "groceryLists", listId, "items", itemId));
    } catch (error) {
        console.error("Error deleting grocery item:", error);
    }
}

// ── 3d. Meal Plans ──────────────────────────────────────────────────────────
// Collection: users/{uid}/mealPlans/{dateKey}
//   Document ID is the date string "YYYY-MM-DD".
//   Fields: date (string), updatedAt (serverTimestamp),
//           meals: { "Breakfast" | "Lunch" | "Dinner" | "Snack":
//               { recipeId, title, image, readyInMinutes, calories } }

function dateKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}

async function saveMealPlan(dateStr, mealType, recipe) {
    if (!uid()) return;
    try {
        const ref = doc(db, "users", uid(), "mealPlans", dateStr);
        const snap = await getDoc(ref);
        const existing = snap.exists() ? snap.data().meals : {};
        existing[mealType] = {
            recipeId: recipe.spoonacularId || recipe.id || null,
            title: recipe.title || recipe.name || "",
            image: recipe.image || "",
            readyInMinutes: recipe.readyInMinutes || null,
            calories: recipe.calories || null
        };
        await setDoc(ref, { date: dateStr, meals: existing, updatedAt: serverTimestamp() }, { merge: true });
    } catch (error) {
        console.error("Error saving meal plan:", error);
    }
}

/*
 * Removing a meal type from a date. If no meals remain after removal,
 * the entire meal plan document is deleted.
 */
async function removeMealPlan(dateStr, mealType) {
    if (!uid()) return;
    try {
        const ref = doc(db, "users", uid(), "mealPlans", dateStr);
        const snap = await getDoc(ref);
        if (!snap.exists()) return;
        const meals = snap.data().meals;
        delete meals[mealType];
        if (Object.keys(meals).length === 0) {
            await deleteDoc(ref);
        } else {
            await setDoc(ref, { meals, updatedAt: serverTimestamp() }, { merge: true });
        }
    } catch (error) {
        console.error("Error removing meal plan:", error);
    }
}

// ── getMealPlansInRange — batch-load meal plans for a date range ────────────
async function getMealPlansInRange(startDate, endDate) {
    if (!uid()) return [];
    try {
        const snap = await getDocs(query(
            collection(db, "users", uid(), "mealPlans"),
            where("date", ">=", dateKey(startDate)),
            where("date", "<=", dateKey(endDate))
        ));
        return snap.docs.map(d => d.data());
    } catch (error) {
        console.error("Error getting meal plans in range:", error);
        return [];
    }
}

// ── 3e. Saved Foods ─────────────────────────────────────────────────────────
// Stored as an array field on the user document (users/{uid}).
//   Field: savedFoods (array<string>)

async function loadSavedFoods() {
    if (!uid()) return [];
    try {
        const snap = await getDoc(doc(db, "users", uid()));
        return snap.exists() ? (snap.data().savedFoods || []) : [];
    } catch (error) {
        console.error("Error loading saved foods:", error);
        return [];
    }
}
async function addSavedFood(foodName) {
    if (!uid()) return;
    try {
        await updateDoc(doc(db, "users", uid()), { savedFoods: arrayUnion(foodName) });
    } catch (error) {
        console.error("Error adding saved food:", error);
    }
}
async function removeSavedFood(foodName) {
    if (!uid()) return;
    try {
        await updateDoc(doc(db, "users", uid()), { savedFoods: arrayRemove(foodName) });
    } catch (error) {
        console.error("Error removing saved food:", error);
    }
}

// =============================================================================
// 4. AUTH & ONBOARDING
// =============================================================================

//Global vars
let formData;
const parentModal = document.querySelector(".modal-overlay")

const loadingQuotes = [
    "Crafting your culinary journey...",
    "Nourishing your world, one bite at a time...",
    "Unleashing the chef within you...",
    "Savor the moment while we prepare your plan...",
    "Building your path to a healthier you...",
    "Discovering delicious possibilities...",
    "Creating a meal plan tailored to your taste...",
    "Let's cook up something amazing!",
    "Your personalized kitchen awaits.",
    "Optimizing your nutrition profile...",
    "Gathering the ingredients for your success...",
    "Hungry for a better diet? We're on it...",
    "Your grocery list is on its way...",
    "Cooking up a storm of flavor...",
    "Satisfying your cravings, one meal at a time.",
    "Personalizing your plate...",
    "Unlocking the secrets of your fridge...",
    "Your dietary needs, our top priority...",
    "Creating a delicious blueprint for your day...",
    "Wholesome goodness is on its way...",
    "Unleashing the power of good food...",
];


// let ev = (event) => {
//     // Cancel the event as stated by the standard.
//     event.preventDefault();
//
//     // Chrome requires returnValue to be set.
//     event.returnValue = true;
//
//     return "Are you sure you want to close this page?";
// }

//This is to log the user in and verify auth + onboarding
//When the state of auth changes, on page load, check if user is allowed

window.addEventListener('load', () => {

    //When the FB auth state is changed (i.e. login)
    onAuthStateChanged(auth, async user => {
        //if user exists, then let them stay; otherwise, take them to signup
        user? console.log("user allowed"): location.replace("auth.html")

        //snapshot of user's document
        const userDocSnap = await getDoc(doc(db, "users/" + auth.currentUser.uid))

        //if the snapshot even exists, hide the onboarding form, otherwise show it, and make the page not close
        if(userDocSnap.exists()) {
            // console.log("user document data: " + JSON.stringify(userDocSnap.data()))
            parentModal.style.display = "none";
            document.querySelector("#username").innerText = auth.currentUser.displayName
            document.querySelector(".profile-container").setAttribute("data-content", auth.currentUser.displayName) //TODO: Change this tooltip
        } else {
            // console.log("no such doc");
            parentModal.style.display = "flex";
            document.querySelector("#username").innerText = "<user_name>"
            //form refresh stop {
            // window.addEventListener('beforeunload', ev);
        }

    })

    //TODO: loading screen stuff
    const quote = document.getElementById("load-quotes");
    const loadContainer = document.querySelector(".loader-container")
    let randomIndex = Math.floor(Math.random() * loadingQuotes.length)
    quote.innerText = loadingQuotes[randomIndex]
    quote.style.opacity = "1";

    //random seconds (1.5 to 3.8) converted to ms, and then a delay of 1800 ms after that
    let msArbitrary = getRandomInt(15, 38) * 100;

    let msRemoveArb = msArbitrary + 1800;

    // console.log(msArbitrary)

    setTimeout(() => {
        loadContainer.style.opacity = "0";
    }, msArbitrary)

    setTimeout(() => {
        document.body.removeChild(loadContainer)
    }, msRemoveArb)

});


//Onboarding flow (Ask users about diet, their age, BW, Display Name, )
//after onboarding, addDoc.

// ONBOARDING FLOW
let currentTab = 0; // Current tab is set to be the first tab (0)
if(parentModal.style.display !== "none"){
    showTab(currentTab); // Display the current tab
}

//"Next" and "Previous" buttons
const prevBtn = document.getElementById("prevBtn")
const nextBtn = document.getElementById("nextBtn")
const onboardingForm = document.getElementById("onboarding-form");

onboardingForm.addEventListener("keypress", e => {
    if(e.key === "Enter") {
        e.preventDefault();
        return false;
    }
})

/*
 * ── Onboarding form submission ──────────────────────────────────────────────
 * Called when the multi-step onboarding form is submitted. Gathers user inputs
 * (name, birth date, height, weight, goal, diet preferences), creates a
 * Firestore document at users/{uid}, sets the display name via Firebase Auth
 * updateProfile, then reloads the page so the dashboard mounts without the
 * onboarding overlay.
 */
onboardingForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    // window.removeEventListener("beforeunload", ev);

    //Save userdata with firestore here
    let fname = document.getElementById("fname").value
    let lnameInput = document.getElementById("lname")
    let lname = lnameInput.value? lnameInput.value : "";
    let birthDate = document.getElementById("date").value;
    let height = document.getElementById("height-in").value;
    let weight = document.getElementById("weight-lb").value;
    let goal = document.getElementById("goal-select").value;

    //Compile user inputs into an Object which can be later used to make the user a Firestore doc
    formData = {
        birthDate: birthDate,
        height: height,
        weight: weight,
        dietPrefs: {},
        goal: goal
    }

    //Append only selected checkboxes to save space
    const dietCheckboxes = document.querySelectorAll(".checkbox-container>input[type='checkbox']")

    //checkbox handling since for some reason form doesnt work
    for(let box of dietCheckboxes) {
        if(box.checked) {
            //give each "dietPref" a key of the form input name
            formData.dietPrefs[box.name] = true;
        }
    }

    //if the last name isn't empty, give them first + last name, otherwise only first
    //which is required
    let userDispName = lname !== ""? fname + " " + lname : fname;

    updateProfile(auth.currentUser, {
        displayName: userDispName
    })

    // console.log(auth.currentUser);

    document.querySelector("#username").innerText = auth.currentUser.displayName

    try {
        await setDoc(doc(db, "users", auth.currentUser.uid), formData);
        // console.log("doc set");
    } catch (error) {
        console.error(error);
    }

    // window.onbeforeunload = null;

    parentModal.style.display = "none"
    location.reload();



})

function showTab(n, prev = false) {
    // This function will display the specified tab of the form ...
    const x = document.getElementsByClassName("tab");

    if(prev) {
        x[n].style.left = "-105%";
    } else {
        x[n].style.left = "105%"
    }

    setTimeout(() => {
        x[n].style.display = "flex"
        setTimeout(() => x[n].style.left = "0%", 10);
    }, 300)




    // ... and fix the Previous/Next buttons:
    if (n === 0) {
        document.getElementById("prevBtn").style.display = "none";
    } else {
        document.getElementById("prevBtn").style.display = "flex";
    }
    if (n === (x.length - 1)) {
        document.getElementById("nextBtn").style.display = "none";
        document.getElementById("submitBtn").style.display = "flex";
    } else {
        document.getElementById("nextBtn").style.display = "flex";
        document.getElementById("submitBtn").style.display = "none";
    }
    // ... and run a function that displays the correct step indicator:
    fixStepIndicator(n)
}

prevBtn.addEventListener("click", (e) => {
    e.preventDefault()
    nextPrev(-1)
})

nextBtn.addEventListener("click", (e) => {
    e.preventDefault()
    nextPrev(1)
})



function nextPrev(n) {
    // This function will figure out which tab to display
    const x = document.getElementsByClassName("tab");
    // Exit the function if any field in the current tab is invalid:
    //If trying to go to next tab
    if (n === 1 && !validateForm()){
        return false;
    }
    // Hide the current tab:
    // Increase or decrease the current tab by 1:

    if (n === 1) {
        x[currentTab].style.left = "-105%"
        setTimeout(() => x[currentTab-n].style.display = "none", 300)
    } else { //n === -1
        setTimeout(() => x[currentTab-n].style.display = "none", 300)
        x[currentTab].style.left = "105%"
    }

    currentTab += n;

    // if you have reached the end of the form... :
    if (currentTab >= x.length) {
        //...the form gets submitted:
        // onboardingForm.submit();
        return false;
    }
    // Otherwise, display the correct tab:
    n === 1? showTab(currentTab): showTab(currentTab, true);
}

function validateForm() {
    // This function deals with validation of the form fields
    let tabs, inputs, valid = true;

    tabs = document.getElementsByClassName("tab");
    inputs = tabs[currentTab].getElementsByTagName("input");

    const dropdown = document.getElementById("goal-select")



    for(let input of inputs) {
        // If a field is empty...
        if (input.hasAttribute("required") && input.value === "") {
            // add an "invalid" class to the field:
            input.className += " invalid";
            // and set the current valid status to false:
            valid = false;
        }

        //if it's the fourth (BW + Height) tab

        if(currentTab === 3) {

            if(input.name === "height-in" && (input.valueAsNumber < 48 || input.valueAsNumber > 100) ) {
                // add an "invalid" class to the field:
                input.className += " invalid";
                // and set the current valid status to false:
                valid = false;
            }
            if (input.name === "weight-lb" && (input.valueAsNumber < 90 || input.valueAsNumber > 400)) {
                // add an "invalid" class to the field:
                input.className += " invalid";
                // and set the current valid status to false:
                valid = false;
            }

            //Date tab
        } else if (currentTab === 2) {
            if(input.valueAsDate >= new Date(input.max) || input.valueAsDate <= new Date(input.min)){
                // add an "invalid" class to the field:
                input.className += " invalid";
                // and set the current valid status to false:
                valid = false;
            }
        }
    }

    if (currentTab === 5) {
        if(dropdown.value === "" || dropdown.value === "Choose one...") {
            // add an "invalid" class to the field:
            dropdown.className += "invalid"
            // and set the current valid status to false:
            valid = false;
        }
    }



    // If the valid status is true, mark the step as finished and valid:
    if (valid) {
        document.getElementsByClassName("step")[currentTab].className += " finish";
    }
    return valid; // return the valid status
}

function fixStepIndicator(n) {
    // This function removes the "active" class of all steps...
    let i, x = document.getElementsByClassName("step");
    for (i = 0; i < x.length; i++) {
        x[i].className = x[i].className.replace(" active", "");
    }
    //... and adds the "active" class to the current step:
    x[n].className += " active";
}

//END ONBOARDING FLOW

// =============================================================================
// 5. DASHBOARD TAB SWITCHING
// =============================================================================
/*
 * Sidebar navigation: clicking a `.page-link` hides all `.dash-tab` sections
 * and shows the tab whose class matches `{link class}-tab`.
 * e.g. class="grocery page-link" → shows `.grocery-tab`.
 * Settings is handled separately via the gear icon.
 */

const pageLinks = document.querySelectorAll(".page-link")
const settingsIcon = document.getElementById("settings-icon")
const dashboardTabs = document.querySelectorAll(".dash-tab")

let _tabSwitched = false;

function pageLinkCallback () {
    _tabSwitched = false;
    if (this.classList.contains("link-selected")) return;
    _tabSwitched = true;
    for(let tab of dashboardTabs) {
        tab.style.display = "none"
    }
    let relTabClass = this.classList[0] + "-tab"
    const relTab = document.querySelector("." + relTabClass)
    relTab.style.display = "flex"

    for(let link of pageLinks) link.classList.remove("link-selected");
    settingsIcon.classList.remove("link-selected");
    this.classList.add("link-selected");
}

pageLinks.forEach(pageLink => pageLink.addEventListener("click", pageLinkCallback));

settingsIcon.addEventListener("click", () => {
    if (settingsIcon.classList.contains("link-selected")) return;
    dashboardTabs.forEach(tab => {
        tab.style.display = "none"
    })
    document.querySelector(".settings-tab").style.display = "flex"
    pageLinks.forEach(link => link.classList.remove("link-selected"))
    settingsIcon.classList.add("link-selected")
});

// =============================================================================
// 6. SEARCH & INGREDIENT PICKER
// =============================================================================
/*
 * The search flow is driven by a single keyup listener on the ingredients input.
 *
 *   ┌─ Space ──► Autocomplete (ingredientsAPI.autocompleteIngredientSearch)
 *   │           Creates <li> items in the autocomplete dropdown; clicking one
 *   │           creates an ingredient tag.
 *   ├─ Backspace ──► Delete last ingredient tag if input is empty.
 *   ├─ Escape ──► Hide autocomplete dropdown.
 *   └─ Enter ──► Run the search (see runSearch() below).
 *
 * Ingredient tags (<li>) are stored in #user-choices-container and represent
 * the current search query. Their inner text is collected and comma-joined
 * to form the Spoonacular `ingredients` parameter.
 */

const parentUl = document.getElementById('user-choices-container')
const ingInput = document.getElementById("ingredients-input");
const acResultsUl = document.querySelector("section.search-tab .search-group ul.autocomplete-container")

const autocorrectContainer = document.querySelector("ul.autocomplete-container")

var searchTopicOpts = document.querySelectorAll("button.search-topic-opt")
var selectedSearchTopic;

let removeChoiceBtns = document.querySelectorAll("ul#user-choices-container li i.fas.fa-close")

/*
 * Create an ingredient tag <li> from the current input value and append it
 * to the tag container. Clears the input and re-query all close buttons to
 * wire up their click-to-remove handlers.
 */
function createTag() {

    const newIng = fromHTML(`<li>
        ${ingInput.value}
        <i class="fas fa-close"></i>
    </li>`)

    //append the new <li> to the <ul>
    parentUl.appendChild(newIng);

    ingInput.value = "";

    parentUl.scrollBy({
        left: 2000,
        top: 0,
        behavior: 'smooth'
    })

    removeChoiceBtns = document.querySelectorAll("ul#user-choices-container li i.fas.fa-close")


    removeChoiceBtns.forEach(btn => {
        btn.addEventListener("click", () => {
            parentUl.removeChild(btn.parentElement)
            if (parentUl.children.length === 0) {
                const srCont = document.querySelector(".search-results-container .search-results-scroll-container");
                while (srCont.firstElementChild) srCont.removeChild(srCont.firstChild);
            }
        })
    })


}

/**
 * show or hide autocorrect container
 * @param isVisible {boolean} - state of visibility of autocorrect container
 */
function actVisible(isVisible) {
    if (isVisible) {
        autocorrectContainer.scrollTo({
            top: 0,
            // left: 0,
            behavior: 'smooth' // Can be 'smooth' or 'auto'
        });
        autocorrectContainer.classList.add("active");
    } else {
        autocorrectContainer.classList.remove("active");
    }
}

//TODO: use throttle func
//TODO: use caching to minimize requests

// =============================================================================
// 6b. FILTER MODAL
// =============================================================================
/*
 * Cuisine / diet / intolerance / meal type / sort filters powered by the
 * Spoonacular complexSearch API. Filters are stored in `activeFilters` and
 * applied as query parameters to the searchRecipes() call when present.
 *
 * The filter modal (#filter-modal) slides up from the bottom (fullscreen on
 * mobile, centered card on desktop). Chips are toggled by clicking; the active
 * count is reflected in a badge on the FILTERS button.
 *
 * When filters are active, runSearch() uses searchRecipes() (with all filter
 * params) instead of searchRecipesByIngredients(). The response format differs
 * (extendedIngredients vs usedIngredients/missedIngredients) so the card
 * builder accepts an optional ingredientImages array for the filtered path.
 */

const activeFilters = { cuisine: [], diet: [], intolerances: [], type: [], sort: '', sortDirection: 'desc' };

const filterModal = document.getElementById('filter-modal');
const openFiltersBtn = document.getElementById('open-filters-btn');
const closeFiltersBtn = document.getElementById('filter-close-btn');
const applyFiltersBtn = document.getElementById('filter-apply-btn');
const clearFiltersBtn = document.getElementById('filter-clear-btn');
const filterBadge = document.getElementById('filter-badge');
const filterSortDirBtn = document.getElementById('filter-sort-dir');

function getActiveFilterCount() {
    let c = 0;
    if (activeFilters.cuisine.length) c += activeFilters.cuisine.length;
    if (activeFilters.diet.length) c += activeFilters.diet.length;
    if (activeFilters.intolerances.length) c += activeFilters.intolerances.length;
    if (activeFilters.type.length) c += activeFilters.type.length;
    if (activeFilters.sort) c++;
    return c;
}

function updateFilterBadge() {
    const count = getActiveFilterCount();
    if (count > 0) {
        filterBadge.textContent = count;
        filterBadge.hidden = false;
    } else {
        filterBadge.hidden = true;
    }
}

function openFilterModal() {
    filterModal.classList.add('open');
    filterModal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
}

function closeFilterModal() {
    filterModal.classList.remove('open');
    filterModal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
}

if (openFiltersBtn) openFiltersBtn.addEventListener('click', openFilterModal);
if (closeFiltersBtn) closeFiltersBtn.addEventListener('click', closeFilterModal);
if (filterModal) {
    filterModal.addEventListener('click', e => { if (e.target === filterModal) closeFilterModal(); });
}

function setupFilterChips(containerId, filterKey) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.querySelectorAll('.filter-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            const val = chip.dataset.value;
            const idx = activeFilters[filterKey].indexOf(val);
            if (idx === -1) {
                activeFilters[filterKey].push(val);
                chip.classList.add('active');
            } else {
                activeFilters[filterKey].splice(idx, 1);
                chip.classList.remove('active');
            }
        });
    });
}

setupFilterChips('cuisine-chips', 'cuisine');
setupFilterChips('diet-chips', 'diet');
setupFilterChips('intolerance-chips', 'intolerances');
setupFilterChips('type-chips', 'type');

const filterSortSelect = document.getElementById('filter-sort');
if (filterSortSelect) {
    filterSortSelect.addEventListener('change', () => {
        activeFilters.sort = filterSortSelect.value;
    });
}

if (filterSortDirBtn) {
    filterSortDirBtn.addEventListener('click', () => {
        activeFilters.sortDirection = activeFilters.sortDirection === 'desc' ? 'asc' : 'desc';
        filterSortDirBtn.dataset.dir = activeFilters.sortDirection;
        const icon = filterSortDirBtn.querySelector('i');
        icon.className = activeFilters.sortDirection === 'desc' ? 'fas fa-arrow-down-wide-short' : 'fas fa-arrow-up-wide-short';
    });
}

if (clearFiltersBtn) {
    clearFiltersBtn.addEventListener('click', () => {
        activeFilters.cuisine = [];
        activeFilters.diet = [];
        activeFilters.intolerances = [];
        activeFilters.type = [];
        activeFilters.sort = '';
        activeFilters.sortDirection = 'desc';
        filterModal.querySelectorAll('.filter-chip.active').forEach(c => c.classList.remove('active'));
        if (filterSortSelect) filterSortSelect.value = '';
        if (filterSortDirBtn) {
            filterSortDirBtn.dataset.dir = 'desc';
            filterSortDirBtn.querySelector('i').className = 'fas fa-arrow-down-wide-short';
        }
        updateFilterBadge();
    });
}

if (applyFiltersBtn) {
    applyFiltersBtn.addEventListener('click', () => {
        updateFilterBadge();
        closeFilterModal();
        if (removeChoiceBtns.length > 0) {
            runSearch();
        }
    });
}

function hasActiveFilters() {
    return activeFilters.cuisine.length > 0 || activeFilters.diet.length > 0 ||
           activeFilters.intolerances.length > 0 || activeFilters.type.length > 0 ||
           !!activeFilters.sort;
}

/*
 * ── buildSearchResultCard(el, ingredientImages?) ────────────────────────────
 * Creates a .search-result-card element from a Spoonacular recipe result.
 *
 * Two call paths:
 *   a) searchRecipesByIngredients() — `el` has .usedIngredients and .missedIngredients
 *   b) searchRecipes() (filtered) — `el` has .extendedIngredients; pass
 *      ingredientImages as pre-built URLs from extendedIngredients.
 *
 * The card includes a bookmark button (save/unsave toggle) and a "Recipe →"
 * button that opens the recipe detail modal.
 */
function buildSearchResultCard(el, ingredientImages) {
    let imagesFound = [];
    let imagesUsed = [];

    if (ingredientImages && ingredientImages.length > 0) {
        imagesFound = ingredientImages;
    } else if (el.usedIngredients || el.missedIngredients) {
        (el.usedIngredients || []).forEach(ing => imagesFound.push(ing.image));
        (el.missedIngredients || []).forEach(ing => imagesFound.push(ing.image));
    }

    for (let x = 0; x < Math.min(3, imagesFound.length); x++) imagesUsed.push(imagesFound[x]);
    if (imagesUsed.length < 3 && imagesFound.length > 0) {
        let x = imagesUsed.length - 1;
        while (imagesUsed.length < 3) { imagesUsed.push(imagesFound[x]); x++; }
    }

    let xtraIngCt = imagesFound.length - imagesUsed.length;
    let hoverTitles = imagesUsed.map(url => {
        let split = url.split("/");
        let mod = split[split.length - 1].trim().split("-").join(" ");
        return mod.charAt(0).toUpperCase() + mod.substring(1, mod.length - 4);
    });

    let newResultCard = fromHTML(
        `<div class="search-result-card" data-recipe-id="${el.id}">
            <div class="result-img-container">
                <img style="--bg-image: url(${el.image || '../../placeholder.svg'})" src="${el.image || './placeholder.svg'}" width="300" height="200" class="search-result-img" alt="">
                <button class="bookmark-btn" data-id="${el.id}" data-title="${el.title || 'Search Result'}" data-image="${el.image || ''}" aria-label="Save recipe"><i class="far fa-bookmark"></i></button>
            </div>
            <div class="search-result-info">
                <h4>${el.title || "Search Result"}</h4>
                <div class="result-meta">
                    <div class="ingredient-icons">
                        <span data-title="${hoverTitles[0] || ""}"><img class="ingredient-img" src="${imagesUsed[0] || "./placeholder.svg"}" alt="" width="20" height="20"></span>
                        <span data-title="${hoverTitles[1] || ""}"><img class="ingredient-img" src="${imagesUsed[1] || "./placeholder.svg"}" alt="" width="20" height="20"></span>
                        <span data-title="${hoverTitles[2] || ""}"><img class="ingredient-img" src="${imagesUsed[2] || "./placeholder.svg"}" alt="" width="20" height="20"></span>
                    </div>
                    <div>${xtraIngCt > 0 ? '+' + xtraIngCt : ""}</div>
                    <button class="view-recipe">Recipe <i class="fas fa-arrow-right"></i></button>
                </div>
            </div>
        </div>`);

    const bookmarkBtn = newResultCard.querySelector('.bookmark-btn');
    bookmarkBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!uid()) { alert("Please sign in to save recipes."); return; }
        const icon = bookmarkBtn.querySelector('i');
        const isSaved = icon.classList.contains('fas');
        const recipeData = {
            id: Number(el.id), title: String(el.title), image: String(el.image || ''),
            readyInMinutes: el.readyInMinutes || null, servings: el.servings || null,
            usedIngredients: (el.usedIngredients || []).map(i => ({ id: i.id, name: i.name, amount: i.amount, unit: i.unit, image: i.image })),
            missedIngredients: (el.missedIngredients || []).map(i => ({ id: i.id, name: i.name, amount: i.amount, unit: i.unit, image: i.image }))
        };
        if (isSaved) { await unsaveRecipe(el.id); icon.classList.remove('fas'); icon.classList.add('far'); }
        else { await saveRecipe(recipeData); icon.classList.remove('far'); icon.classList.add('fas'); }
    });

    const viewBtn = newResultCard.querySelector('.view-recipe');
    viewBtn.addEventListener('click', () => openRecipeDetail(el.id));

    if (uid()) {
        isRecipeSaved(el.id).then(saved => {
            if (saved) { bookmarkBtn.querySelector('i').classList.remove('far'); bookmarkBtn.querySelector('i').classList.add('fas'); }
        }).catch(() => {});
    }

    return newResultCard;
}

/*
 * ── runSearch() ──────────────────────────────────────────────────────────────
 * Entry point for both the Enter-key shortcut and the "Show Results" button
 * in the filter modal. Collects ingredient tags from #user-choices-container
 * and dispatches to one of two Spoonacular endpoints:
 *
 *   No active filters:
 *     searchRecipesByIngredients(ingredients, { number:25, ranking:1 })
 *
 *   Active filters present:
 *     searchRecipes('', { includeIngredients, cuisine, diet, intolerances,
 *                         type, sort, sortDirection, addRecipeInformation,
 *                         fillIngredients, instructionsRequired })
 */
async function runSearch() {
    let userChoiceSet = new Set(Array.from(document.querySelectorAll("ul#user-choices-container li")).map(_ => _.innerText));
    if (userChoiceSet.size === 0) return;

    const srCont = document.querySelector(".search-results-container .search-results-scroll-container");
    while (srCont.firstElementChild) srCont.removeChild(srCont.firstChild);

    let ingredients = [...userChoiceSet].join(",").replaceAll(" ", "+");

    if (hasActiveFilters()) {
        let opts = {
            number: 25,
            fillIngredients: true,
            addRecipeInformation: true,
            instructionsRequired: true,
            ignorePantry: false,
            includeIngredients: ingredients
        };
        if (activeFilters.cuisine.length) opts.cuisine = activeFilters.cuisine.join(',');
        if (activeFilters.diet.length) opts.diet = activeFilters.diet.join(',');
        if (activeFilters.intolerances.length) opts.intolerances = activeFilters.intolerances.join(',');
        if (activeFilters.type.length) opts.type = activeFilters.type.join(',');
        if (activeFilters.sort) {
            opts.sort = activeFilters.sort;
            opts.sortDirection = activeFilters.sortDirection;
        }

        recipesAPI.searchRecipes('', opts, async (error, data, response) => {
            if (error) { console.error(error); return; }

            const results = data.results || [];
            if (results.length === 0) { alert("No results found :/"); return; }
            for (const el of results) {
                let ingredientImages = [];
                if (el.extendedIngredients && el.extendedIngredients.length) {
                    ingredientImages = el.extendedIngredients.slice(0, 6).map(ing => `https://img.spoonacular.com/ingredients_100x100/${ing.image}`);
                }
                srCont.appendChild(buildSearchResultCard(el, ingredientImages));
            }
        });
    } else {
        let opts = { number: 25, ranking: 1, ignorePantry: false };
        recipesAPI.searchRecipesByIngredients(ingredients, opts, async (error, data, response) => {
            if (error) { console.error(error); return; }
            if (data.length === 0) { alert("No results found :/"); return; }
            for (const el of data) srCont.appendChild(buildSearchResultCard(el));
        });
    }
}

ingInput.addEventListener("keyup", e => {

    //disable autocorrect container after user begins typing
    actVisible(false);

    //filter input
    ingInput.value = ingInput.value.toLowerCase().trim().replaceAll(/[^a-zA-Z]/g, "")


    if (e.key === "Escape") {
        actVisible(false);
        return;
    }
    //if not deleting and at least 1 non-filtered character present, show autocorrect container
    //TODO: link to state var and update only when request is returned from later statement, potentially get rid of this clause and move it further down
    else if (!(e.key === "Backspace" || e.code === "Backspace") && ingInput.value.length >= 1) {
        window.setTimeout(e => actVisible(true), 550)
    }

    // ingredient tag handler
    if ((e.key === "Backspace" || e.code === "Backspace")) {
        actVisible(false);

        //begin to delete existing tags
        if(ingInput.value.length === 0 && parentUl.children.length > 0) {
            parentUl.removeChild(
                parentUl.children[parentUl.children.length - 1]
            );
        }

        // if (parentUl.children.length === 1 || ingInput.value.length === 1) {
        //
        //     ingInput.placeholder = "Search..."
        // }

    } else if (e.code === "Space" && ingInput.value.length > 0) {
        //add whatever is in the input to tag ul
        // createTag()

        //request autocompletion
        ingredientsAPI.autocompleteIngredientSearch(ingInput.value, {
          "number": 10,
          "metaInformation": true
        }, (error, data, response) => {
          if (error) {
            console.error(error)
            return;
          }
           console.log("Returned API data: " + JSON.stringify(data))

          while (acResultsUl.lastElementChild) {
            acResultsUl.removeChild(acResultsUl.lastElementChild)
          }

          data.forEach(el => {

            const newAcLi = fromHTML(`<li tabindex="0" id="${el.id}">${el.name}</li>`)

            acResultsUl.appendChild(newAcLi)

            let acLiElement = document.getElementById(el.id)

            acLiElement.addEventListener('click', () => {
              ingInput.value = acLiElement.innerText
              autocorrectContainer.style.display = "none";
              createTag()
              ingInput.focus()
            })


          });

          //   var acLis = document.querySelectorAll('.ac-result')

          //   for(var li of acLis) {
          //     li.addEventListener('click', () => {

          //     })
          //   }

          if (acResultsUl.children.length === 0) {

            let noneLabel = fromHTML(`<li disabled class="ac-result">No items found</li>`)

            acResultsUl.appendChild(noneLabel)
          }

          autocorrectContainer.style.display = "unset"

          autocorrectContainer.scrollTop = 0;

        })


    } else if (e.key === "Enter" && removeChoiceBtns.length > 0) {
        e.preventDefault();
        runSearch();
    }

})

ingInput.addEventListener("click", e => {
    autocorrectContainer.classList.remove("active");
})
//handle sub-input topic buttons
searchTopicOpts.forEach(el => {
    el.addEventListener("click", e => {
        let previousEl = document.querySelector("button.search-topic-opt.selected")
        previousEl.classList.remove("selected")

        el.classList.add("selected");
        selectedSearchTopic = el
    })
})

//logout handling
const logoutBtn = document.getElementById("log-out-btn");
logoutBtn.addEventListener('click', () => {

    signOut(auth).then(() => {
        console.log('user signed out!')
        location.href = '/index.html';
    })

})

async function scrapeStaticPage() {
    let products = [];

    try {
        // 1. Fetch raw HTML
        const { data } = await axios.get('https://blog.myfitnesspal.com/category/nutrition/nutrition-guides/');

        // 2. Load HTML into Cheerio
        const $ = cheerio.load(data);



        // 3. Loop through elements using CSS selectors
        $(".elementor-loop-container.elementor-grid div.e-loop-item div.e-con-inner").each((index, element) => {
            let img = $(element).find($('img.attachment-full')).attr('srcset')
            let title = $(element).find('h4.elementor-heading-title a').text().trim();
            let desc = $(element).find('.elementor-shortcode').text().trim();
            let link = $(element).find(".elementor-widget-container a:first-child").attr("href")
            let rank = true;

            if (!img) {
                // chec if tlink exst, then pipe axios to that link to check for the hero image of the full article page
                // iff not, then rank false
                // prob do same for others
                // TODO: evemtually, have own scraped article page with cachesx
                img = "./placeholder.svg"
                rank = false;
            } else {
                img = img.split(" ")[0]
            }

            if (!title) {
                title = "Story"
                rank = false
            }

            if (!desc) {
                desc = "5 minute read"
                rank = false
            }

            if (!link) {
                //TODO: error popup or remove story
                link = "#"
                rank = false
            }


            products.push({ img, title, desc, link, rank });
            // console.log(link)
        });


        // console.log(JSON.stringify(products));
    } catch (error) {
        console.error('Scraping failed:', error);
    }


    let featBox = document.querySelector(".featured-content .cards-container")
    let suggestBox = document.querySelector(".suggested-content .cards-container")
    let f = 0;

    // featBox.childNodes.forEach(f=>{
    //     featBox.removeChild(f)
    //     console.log("f child removed")
    // })
    //
    // suggestBox.childNodes.forEach(s=>{
    //     suggestBox.removeChild(s)
    //     console.log("s child removed")
    // })

    let cards = document.querySelectorAll(".story-card")

    cards.forEach(c => {
        c.parentNode.removeChild(c)
    })

    products = Array.from(new Set(products))

    products.forEach(product => {
        let newStory = fromHTML(`<div class="story-card">
                            <div class="story-img-container">
                                <img src=${product.img} width="300" height="200" alt="Story Image" class="story-img">
                            </div>
                            <div class="story-info">
                                <h4>${product.title}</h4>
                                <p>${product.desc}</p>
                            </div>
                        </div>`)

                newStory.addEventListener("click", () => {
            openReader(product);
        })


        if (product.rank && f < 3) {
            featBox.appendChild(newStory)
            f++
        } else {
            suggestBox.appendChild(newStory)
        }

        console.log(f)

        // ((product.rank && f < 3) ? featBox : suggestBox).appendChild(newStory)


    })
}

scrapeStaticPage().catch(e => console.error(e))

// =============================================================================
// 7. READER MODAL (ARTICLE SCRAPER)
// =============================================================================
/*
 * Opens a full-screen reader overlay for MyFitnessPal nutrition articles.
 * Scrapes the article HTML via an Axios GET + Cheerio parse on the server-
 * less client (works because CORS is permissive from myfitnesspal.com).
 *
 * Two view modes:
 *   - "scraped": parsed article content (strips nav/header/footer/scripts)
 *   - "iframe": original page embedded in a sandboxed iframe
 *
 * The scrapeStaticPage() function (called on page load) fetches the
 * MyFitnessPal blog index, parses story cards, and populates the featured/
 * suggested sections with clickable story cards.
 */
const readerModal = document.getElementById('reader-modal');
const readerTitle = readerModal.querySelector('.reader-title');
const readerScraped = readerModal.querySelector('.reader-scraped');
const readerIframe = readerModal.querySelector('.reader-iframe');
const readerLoading = readerModal.querySelector('.reader-loading');
const readerCloseBtn = readerModal.querySelector('.reader-close');
const readerSourceLink = readerModal.querySelector('.reader-source-link');
const readerModeBtns = readerModal.querySelectorAll('.reader-mode');

let readerActiveMode = 'scraped';

function openReader(product) {
    readerModal.classList.add('open');
    readerModal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';

    readerTitle.textContent = product.title;
    readerSourceLink.href = product.link;
    // readerSourceLink.querySelector('i').nextSibling.textContent = ' ' + new URL(product.link).hostname;

    readerScraped.innerHTML = '';
    readerScraped.classList.remove('active');
    readerIframe.classList.remove('active');
    readerIframe.src = product.link;
    readerLoading.classList.add('active');

    readerActiveMode = 'scraped';
    readerModeBtns.forEach(b => b.classList.toggle('active', b.dataset.mode === 'scraped'));

    scrapeArticleContent(product.link);
}

function closeReader() {
    readerModal.classList.remove('open');
    readerModal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    readerIframe.src = 'about:blank';
    readerScraped.innerHTML = '';
}

readerCloseBtn.addEventListener('click', closeReader);

readerModal.addEventListener('click', e => {
    if (e.target === readerModal) closeReader();
});

document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && readerModal.classList.contains('open')) closeReader();
});

readerModeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        const mode = btn.dataset.mode;
        if (mode === readerActiveMode) return;
        readerActiveMode = mode;

        readerModeBtns.forEach(b => b.classList.toggle('active', b === btn));

        if (mode === 'scraped') {
            readerIframe.classList.remove('active');
            readerScraped.classList.add('active');
        } else {
            readerScraped.classList.remove('active');
            readerIframe.classList.add('active');
        }
    });
});

async function scrapeArticleContent(url) {
    try {
        const { data } = await axios.get(url);
        const $ = cheerio.load(data);

        $('style, script, noscript, iframe, nav, header, footer, .elementor-location-header, .elementor-location-footer').remove();

        let content = $('article').html()
            || $('main').html()
            || $('.elementor-section-wrap').html()
            || $('.entry-content').html()
            || $('body').html();

        if (content) {
            const $c = cheerio.load(content);
            $c('img').each((_, el) => {
                const src = $c(el).attr('src');
                const srcset = $c(el).attr('srcset');
                if (srcset) {
                    $c(el).attr('srcset', srcset);
                }
                if (src && !src.startsWith('http')) {
                    const base = new URL(url);
                    $c(el).attr('src', base.origin + (src.startsWith('/') ? src : '/' + src));
                }
            });

            $c('a').each((_, el) => {
                const href = $c(el).attr('href');
                if (href && !href.startsWith('http') && !href.startsWith('#') && !href.startsWith('javascript')) {
                    const base = new URL(url);
                    $c(el).attr('href', base.origin + (href.startsWith('/') ? href : '/' + href));
                    $c(el).attr('target', '_blank');
                    $c(el).attr('rel', 'noopener noreferrer');
                }
            });

            content = $c.html();
        }

        readerScraped.innerHTML = content || '<p style="color:var(--dashboard-text-muted);text-align:center;padding:3rem 1rem;">Could not load article content.</p>';
    } catch (err) {
        console.error('Article scrape failed:', err);
        readerScraped.innerHTML = `<p style="color:var(--dashboard-text-muted);text-align:center;padding:3rem 1rem;">Failed to load article.<br><a href="${url}" target="_blank" rel="noopener noreferrer" style="color:var(--dashboard-accent);">Open in new tab instead</a></p>`;
    } finally {
        readerLoading.classList.remove('active');
        if (readerActiveMode === 'scraped') {
            readerScraped.classList.add('active');
        }
    }
}

// =============================================================================
// 8. RECIPE DETAIL MODAL
// =============================================================================
/*
 * Fetches full recipe info from Spoonacular (getRecipeInformation with
 * includeNutrition: true) and renders a hero image, summary, ingredients
 * list, step-by-step instructions, and a nutrition grid in a centered overlay
 * that reuses the reader-overlay / reader-container CSS classes.
 */
const recipeDetailModal = document.getElementById('recipe-detail-modal');
const recipeDetailCloseBtn = recipeDetailModal ? recipeDetailModal.querySelector('.recipe-detail-close') : null;
const recipeDetailContainer = recipeDetailModal ? recipeDetailModal.querySelector('.recipe-detail-body') : null;

function closeRecipeDetail() {
    recipeDetailModal.classList.remove('open');
    recipeDetailModal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    recipeDetailContainer.innerHTML = '';
}

if (recipeDetailCloseBtn) {
    recipeDetailCloseBtn.addEventListener('click', closeRecipeDetail);
}
if (recipeDetailModal) {
    recipeDetailModal.addEventListener('click', e => {
        if (e.target === recipeDetailModal) closeRecipeDetail();
    });
}
document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && recipeDetailModal && recipeDetailModal.classList.contains('open')) closeRecipeDetail();
});

async function openRecipeDetail(recipeId) {
    if (!recipeDetailModal) return;
    recipeDetailModal.classList.add('open');
    recipeDetailModal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    recipeDetailContainer.innerHTML = '<div class="recipe-detail-loading"><div class="reader-spinner"></div><p>Loading recipe...</p></div>';

    recipesAPI.getRecipeInformation(recipeId, { includeNutrition: true }, (error, data, response) => {
        if (error) {
            console.error("Error fetching recipe info:", error);
            recipeDetailContainer.innerHTML = '<p style="text-align:center;padding:3rem 1rem;color:var(--dashboard-text-muted);">Failed to load recipe details.</p>';
            return;
        }

        let instructionsHTML = '';
        if (data.analyzedInstructions && data.analyzedInstructions.length > 0) {
            const steps = data.analyzedInstructions[0].steps || [];
            instructionsHTML = `<div class="recipe-detail-section">
                <h3>Instructions</h3>
                <ol class="recipe-detail-steps">
                    ${steps.map(s => `<li><strong>Step ${s.number}:</strong> ${s.step}</li>`).join('')}
                </ol>
            </div>`;
        }

        let ingredientsHTML = '';
        if (data.extendedIngredients && data.extendedIngredients.length > 0) {
            ingredientsHTML = `<div class="recipe-detail-section">
                <h3>Ingredients</h3>
                <ul class="recipe-detail-ingredients">
                    ${data.extendedIngredients.map(ing => `<li>
                        <img src="https://img.spoonacular.com/ingredients_100x100/${ing.image || ''}" alt="" width="30" height="30" onerror="this.style.display='none'">
                        <span>${ing.original || ing.name || ''}</span>
                    </li>`).join('')}
                </ul>
            </div>`;
        }

        let nutritionHTML = '';
        if (data.nutrition && data.nutrition.nutrients && data.nutrition.nutrients.length > 0) {
            const topNutrients = data.nutrition.nutrients.slice(0, 8);
            nutritionHTML = `<div class="recipe-detail-section">
                <h3>Nutrition</h3>
                <div class="recipe-detail-nutrition">
                    ${topNutrients.map(n => `<div class="nutrition-item"><span class="nutrition-value">${Math.round(n.amount)}${n.unit}</span><span class="nutrition-label">${n.name}</span></div>`).join('')}
                </div>
            </div>`;
        }

        recipeDetailContainer.innerHTML = `
            <div class="recipe-detail-hero">
                <img src="${data.image || './placeholder.svg'}" alt="${data.title || ''}" class="recipe-detail-image">
                <div class="recipe-detail-hero-info">
                    <h2>${data.title || ''}</h2>
                    <div class="recipe-detail-meta">
                        ${data.readyInMinutes ? `<span><i class="fas fa-clock"></i> ${data.readyInMinutes} min</span>` : ''}
                        ${data.servings ? `<span><i class="fas fa-utensils"></i> ${data.servings} servings</span>` : ''}
                    </div>
                </div>
            </div>
            ${data.summary ? `<div class="recipe-detail-section"><h3>Summary</h3><div class="recipe-detail-summary">${data.summary}</div></div>` : ''}
            ${ingredientsHTML}
            ${instructionsHTML}
            ${nutritionHTML}
            ${data.sourceUrl ? `<div class="recipe-detail-section"><a href="${data.sourceUrl}" target="_blank" rel="noopener noreferrer" class="recipe-detail-source">View original recipe <i class="fas fa-external-link-alt"></i></a></div>` : ''}
        `;
    });
}

// =============================================================================
// 9. PROFILE & SETTINGS
// =============================================================================
/*
 * Profile tab: loads user data from users/{uid} and populates form fields
 * (name, bio, height, weight, age, goal, diet preferences). Saves changes
 * via setDoc(..., { merge: true }) to avoid overwriting other fields.
 *
 * Settings tab: password update (Firebase Auth updatePassword), preference
 * toggles (notifications / personalization / data sharing) stored in
 * users/{uid}.preferences.
 *
 * Delete account: currently placeholder (prompts user, then shows error).
 */

const profileLink = document.getElementById("profile-link");
const profileTab = document.querySelector(".profile-tab");
const settingsTab = document.querySelector(".settings-tab");

// Navigate to profile page when clicking profile container
profileLink.addEventListener("click", () => {
    dashboardTabs.forEach(tab => tab.style.display = "none");
    profileTab.style.display = "flex";
    pageLinks.forEach(pageLink => pageLink.classList.remove("link-selected"));
    settingsIcon.classList.remove("link-selected");
    loadProfileData();
});

// Load user profile data from Firestore
async function loadProfileData() {
    try {
        const user = auth.currentUser;
        if (!user) return;

        const userDoc = await getDoc(doc(db, "users", user.uid));
        const userData = userDoc.data() || {};

        // Populate profile display
        document.getElementById("profile-display-name").textContent = user.displayName || "User";
        document.getElementById("profile-email").textContent = user.email || "user@example.com";
        document.getElementById("profile-member-since").textContent = `Member since: ${new Date(user.metadata.creationTime).toLocaleDateString()}`;

        // Populate form fields
        const nameParts = (user.displayName || "").split(" ");
        document.getElementById("profile-fname").value = nameParts[0] || "";
        document.getElementById("profile-lname").value = nameParts.slice(1).join(" ") || "";
        document.getElementById("profile-bio").value = userData.bio || "";

        // Populate stats
        if (userData.birthDate) {
            const age = calculateAge(new Date(userData.birthDate));
            document.getElementById("stat-age").textContent = age;
            document.getElementById("profile-age").value = age;
        }

        if (userData.height) {
            document.getElementById("stat-height").textContent = userData.height + '"';
            document.getElementById("profile-height").value = userData.height;
        }

        if (userData.weight) {
            document.getElementById("stat-weight").textContent = userData.weight + " lbs";
            document.getElementById("profile-weight").value = userData.weight;
        }

        if (userData.goal) {
            document.getElementById("stat-goal").textContent = userData.goal;
            document.getElementById("profile-goal").value = userData.goal;
        }

        // Highlight selected dietary preferences
        document.querySelectorAll(".pref-tag").forEach(tag => {
            tag.classList.remove("active");
            if (userData.dietPrefs && userData.dietPrefs[tag.dataset.diet]) {
                tag.classList.add("active");
            }
        });

        // Populate settings email
        document.getElementById("settings-email").value = user.email || "";

    } catch (error) {
        console.error("Error loading profile data:", error);
    }
}

function calculateAge(birthDate) {
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
        age--;
    }
    return age;
}

// Handle dietary preference tag clicks
document.querySelectorAll(".pref-tag").forEach(tag => {
    tag.addEventListener("click", () => {
        tag.classList.toggle("active");
    });
});

// Save profile changes
document.getElementById("profile-save-btn").addEventListener("click", async () => {
    const statusMsg = document.getElementById("profile-status-message");
    try {
        const user = auth.currentUser;
        if (!user) return;

        const fname = document.getElementById("profile-fname").value.trim();
        const lname = document.getElementById("profile-lname").value.trim();
        const displayName = lname ? `${fname} ${lname}` : fname;

        // Update display name
        if (displayName) {
            await updateProfile(user, { displayName });
        }

        // Prepare user data
        const birthDate = document.getElementById("profile-age").value;
        const height = document.getElementById("profile-height").value;
        const weight = document.getElementById("profile-weight").value;
        const goal = document.getElementById("profile-goal").value;
        const bio = document.getElementById("profile-bio").value;

        const dietPrefs = {};
        document.querySelectorAll(".pref-tag.active").forEach(tag => {
            dietPrefs[tag.dataset.diet] = true;
        });

        // Update Firestore document
        const userData = {
            bio: bio,
            birthDate: birthDate ? new Date(birthDate).toISOString() : "",
            height: height ? parseInt(height) : 0,
            weight: weight ? parseInt(weight) : 0,
            goal: goal || "",
            dietPrefs: dietPrefs
        };

        await setDoc(doc(db, "users", user.uid), userData, { merge: true });

        // Show success message
        statusMsg.textContent = "✓ Profile updated successfully!";
        statusMsg.className = "status-message show success";
        setTimeout(() => statusMsg.classList.remove("show"), 3000);

        // Reload profile display
        loadProfileData();
    } catch (error) {
        console.error("Error saving profile:", error);
        statusMsg.textContent = "✗ Error updating profile: " + error.message;
        statusMsg.className = "status-message show error";
    }
});

// Cancel profile changes
document.getElementById("profile-cancel-btn").addEventListener("click", () => {
    loadProfileData();
    const statusMsg = document.getElementById("profile-status-message");
    statusMsg.classList.remove("show");
});

// Update password
document.getElementById("password-save-btn").addEventListener("click", async () => {
    const password = document.getElementById("settings-password").value;
    const confirmPassword = document.getElementById("settings-confirm-password").value;
    const statusMsg = document.getElementById("settings-status-message");

    if (!password || !confirmPassword) {
        statusMsg.textContent = "✗ Please fill in both password fields";
        statusMsg.className = "status-message show error";
        return;
    }

    if (password !== confirmPassword) {
        statusMsg.textContent = "✗ Passwords do not match";
        statusMsg.className = "status-message show error";
        return;
    }

    if (password.length < 6) {
        statusMsg.textContent = "✗ Password must be at least 6 characters";
        statusMsg.className = "status-message show error";
        return;
    }

    try {
        const user = auth.currentUser;
        if (!user) return;

        await user.updatePassword(password);
        statusMsg.textContent = "✓ Password updated successfully!";
        statusMsg.className = "status-message show success";

        document.getElementById("settings-password").value = "";
        document.getElementById("settings-confirm-password").value = "";

        setTimeout(() => statusMsg.classList.remove("show"), 3000);
    } catch (error) {
        console.error("Error updating password:", error);
        statusMsg.textContent = "✗ Error updating password: " + error.message;
        statusMsg.className = "status-message show error";
    }
});

// Handle preference toggles
document.getElementById("notifications-toggle").addEventListener("change", async (e) => {
    try {
        const user = auth.currentUser;
        if (!user) return;
        await setDoc(doc(db, "users", user.uid), 
            { preferences: { notifications: e.target.checked } }, 
            { merge: true }
        );
    } catch (error) {
        console.error("Error updating preferences:", error);
    }
});

document.getElementById("personalization-toggle").addEventListener("change", async (e) => {
    try {
        const user = auth.currentUser;
        if (!user) return;
        await setDoc(doc(db, "users", user.uid), 
            { preferences: { personalization: e.target.checked } }, 
            { merge: true }
        );
    } catch (error) {
        console.error("Error updating preferences:", error);
    }
});

document.getElementById("data-sharing-toggle").addEventListener("change", async (e) => {
    try {
        const user = auth.currentUser;
        if (!user) return;
        await setDoc(doc(db, "users", user.uid), 
            { preferences: { dataSharing: e.target.checked } }, 
            { merge: true }
        );
    } catch (error) {
        console.error("Error updating preferences:", error);
    }
});

// Delete account handler
document.getElementById("delete-account-btn").addEventListener("click", () => {
    const confirmed = confirm("Are you absolutely sure? This action cannot be undone. All your data will be permanently deleted.\n\nType 'DELETE' to confirm.");
    if (confirmed) {
        const statusMsg = document.getElementById("settings-status-message");
        statusMsg.textContent = "✗ Account deletion is not yet implemented. Please contact support.";
        statusMsg.className = "status-message show error";
    }
});


// =============================================================================
// 10. FEEDBACK FORM
// =============================================================================
/*
 * Writes feedback submissions to the top-level `feedback` collection.
 * Each document: type, subject, message, email (optional), uid, timestamp.
 */
; (() => {
    const form = document.querySelector('#feedback-form');
    if (!form) return;
    const message = form.querySelector('#feedback-message');
    const count = form.querySelector('#feedback-count');
    const status = form.querySelector('#feedback-status');
    const submit = form.querySelector('button[type="submit"]');

    const updateCount = () => {
        count.textContent = message.value.length;
    };

    message.addEventListener('input', () => {
        if (message.value.length > 1000) {
            message.value = message.value.slice(0, 1000);
        }

        updateCount();
    });

    form.addEventListener('submit', async event => {
        event.preventDefault();

        if (!form.reportValidity()) {
            return;
        }

        submit.disabled = true;
        status.textContent = 'Sending…';

        try {
            const type = form.querySelector('input[name="feedback-type"]:checked').value;
            const subject = form.querySelector('#feedback-subject').value.trim();
            const msg = message.value.trim();
            const email = form.querySelector('#feedback-email').value.trim();

            await addDoc(collection(db, 'feedback'), {
                type,
                subject,
                message: msg,
                email: email || null,
                uid: auth.currentUser?.uid || null,
                timestamp: serverTimestamp(),
            });

            status.textContent = 'Thank you — your feedback has been received.';
            form.reset();
            updateCount();
        } catch (err) {
            //TODO: catch & log
            console.error('Feedback submission failed:', err);
            status.textContent = 'Something went wrong. Please try again.';
        } finally {
            window.setTimeout(() => {
                submit.disabled = false;
            }, 900);
        }
    });
})();

// =============================================================================
// 11. SAVED RECIPES TAB
// =============================================================================
/*
 * Reads all documents from users/{uid}/recipes and renders them as a grid of
 * .recipe-card elements. Each card shows thumbnail, title, prep time, and
 * servings. Clicking the image or info area opens the recipe detail modal.
 * Clicking the unsave (X) button deletes the document and re-renders.
 *
 * The IIFE exposes _renderSavedRecipes and _getSavedRecipes on window so the
 * meal planner IIFE can reference them (sibling closure, not module-exported).
 */
(() => {
    const tab = document.querySelector('.recipes-tab');
    if (!tab) return;
    const grid = tab.querySelector('#recipes-grid');
    const emptyState = tab.querySelector('#recipes-empty-state');

    async function renderSavedRecipes() {
        const recipes = await getSavedRecipes();
        grid.innerHTML = '';

        if (recipes.length === 0) {
            emptyState.style.display = 'flex';
            grid.style.display = 'none';
            return;
        }

        emptyState.style.display = 'none';
        grid.style.display = 'grid';

        recipes.forEach(recipe => {
            const card = fromHTML(`
                <div class="recipe-card" data-recipe-id="${recipe.spoonacularId}">
                    <div class="recipe-card-image">
                        <img src="${recipe.image || './placeholder.svg'}" alt="${recipe.title || ''}" loading="lazy">
                        <button class="recipe-unsave-btn" data-id="${recipe.spoonacularId}" aria-label="Remove recipe"><i class="fas fa-xmark"></i></button>
                    </div>
                    <div class="recipe-card-info">
                        <h4>${recipe.title || 'Saved Recipe'}</h4>
                        <div class="recipe-card-meta">
                            ${recipe.readyInMinutes ? `<span><i class="fas fa-clock"></i> ${recipe.readyInMinutes} min</span>` : ''}
                            ${recipe.servings ? `<span><i class="fas fa-utensils"></i> ${recipe.servings} servings</span>` : ''}
                        </div>
                    </div>
                </div>
            `);

            card.querySelector('img').addEventListener('click', () => {
                openRecipeDetail(recipe.spoonacularId);
            });

            card.querySelector('.recipe-card-info').addEventListener('click', () => {
                openRecipeDetail(recipe.spoonacularId);
            });

            card.querySelector('.recipe-unsave-btn').addEventListener('click', async (e) => {
                e.stopPropagation();
                await unsaveRecipe(recipe.spoonacularId);
                renderSavedRecipes();
            });

            grid.appendChild(card);
        });
    }

    // Render when tab becomes visible via pageLinkCallback
    const savedRecipesLink = document.querySelector('.recipes.page-link');
    if (savedRecipesLink) {
        savedRecipesLink.addEventListener('click', () => {
            setTimeout(() => {
                if (!_tabSwitched) return;
                renderSavedRecipes();
            }, 50);
        });
    }

    // Initial render
    renderSavedRecipes();

    // Also expose for meal planner to use
    window._renderSavedRecipes = renderSavedRecipes;
    window._getSavedRecipes = getSavedRecipes;
})();

// =============================================================================
// 12. MEAL PLANNER
// =============================================================================
/*
 * Monthly calendar view with per-day meal assignment. Each day can have up to
 * 4 meal slots (Breakfast / Lunch / Dinner / Snack), stored as a single
 * Firestore document per date:
 *   users/{uid}/mealPlans/"YYYY-MM-DD" → { date, meals: { [mealType]: { recipeId, title, image, ... } } }
 *
 * State:
 *   - viewDate:  the month currently displayed (1st of month)
 *   - selectedDate: day highlighted in the calendar
 *   - mealType:   currently selected slot (Breakfast/Lunch/Dinner/Snack)
 *   - recipesMap: local cache loaded from getMealPlansInRange()
 *
 * The recipe picker panel lists saved recipes; clicking one calls saveMealPlan()
 * to save the assignment, then re-renders calendar + selection display.
 */
(() => {
    const tab = document.querySelector('.meal-tab');
    if (!tab) return;
    const calendar = tab.querySelector('#meal-calendar');
    const monthLabel = tab.querySelector('#meal-month-label');
    const selectedDateLabel = tab.querySelector('#meal-selected-date');
    const emptyState = tab.querySelector('#meal-empty-state');
    const assignment = tab.querySelector('#meal-assignment');
    const recipesMap = new Map();
    const today = new Date(); today.setHours(0, 0, 0, 0);
    let viewDate = new Date(today.getFullYear(), today.getMonth(), 1);
    let selectedDate = new Date(today);
    let mealType = 'Dinner';
    const sameDay = (a, b) => a && b && dateKey(a) === dateKey(b);
    const formatDate = date => new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).format(date);

    async function loadMonthPlans() {
        const start = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1);
        const end = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 0);
        try {
            const plans = await getMealPlansInRange(start, end);
            recipesMap.clear();
            plans.forEach(plan => {
                if (plan.meals) {
                    Object.entries(plan.meals).forEach(([type, data]) => {
                        const key = `${plan.date}_${type}`;
                        recipesMap.set(key, {
                            ...data,
                            type: type
                        });
                        recipesMap.set(plan.date, recipesMap.get(plan.date) || {});
                        recipesMap.get(plan.date)[type] = data;
                    });
                }
            });
        } catch (error) {
            console.error("Error loading meal plans:", error);
        }
    }

    async function renderSelection() {
        selectedDateLabel.textContent = formatDate(selectedDate);
        const dateStr = dateKey(selectedDate);
        const dayMeals = recipesMap.get(dateStr) || {};
        const recipe = dayMeals[mealType];

        emptyState.hidden = !!recipe;
        assignment.hidden = !recipe;

        if (recipe) {
            tab.querySelector('#meal-assignment-image').src = recipe.image || './placeholder.svg';
            tab.querySelector('#meal-assignment-image').alt = recipe.title || '';
            tab.querySelector('#meal-assignment-name').textContent = recipe.title || '';
            tab.querySelector('#meal-assignment-meta').textContent = recipe.readyInMinutes ? `${recipe.readyInMinutes} min${recipe.calories ? ' • ' + recipe.calories + ' cal' : ''}` : '';
            tab.querySelector('#meal-assignment-type').textContent = recipe.type || mealType;
        }
    }

    async function renderCalendar() {
        await loadMonthPlans();
        const year = viewDate.getFullYear(), month = viewDate.getMonth();
        monthLabel.textContent = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(viewDate);
        calendar.innerHTML = '';
        const start = new Date(year, month, 1).getDay(), days = new Date(year, month + 1, 0).getDate();
        for (let i = 0; i < start; i++) calendar.append(document.createElement('span'));
        for (let day = 1; day <= days; day++) {
            const date = new Date(year, month, day), button = document.createElement('button');
            button.type = 'button'; button.className = 'meal-calendar-day'; button.textContent = day;
            button.setAttribute('aria-label', `Plan meals for ${formatDate(date)}`);
            if (sameDay(date, today)) button.classList.add('is-today');
            if (sameDay(date, selectedDate)) button.classList.add('is-selected');
            const dateStr = dateKey(date);
            const dayData = recipesMap.get(dateStr);
            const mealCount = dayData && typeof dayData === 'object' ? Object.keys(dayData).length : 0;
            if (mealCount > 0) {
                button.classList.add('has-meal');
                const dots = document.createElement('span');
                dots.className = 'meal-dots';
                dots.setAttribute('aria-hidden', 'true');
                for (let i = 0; i < mealCount; i++) {
                    const dot = document.createElement('span');
                    dot.className = 'meal-dot';
                    dots.appendChild(dot);
                }
                button.appendChild(dots);
            }
            button.addEventListener('click', () => { selectedDate = date; renderCalendar(); renderSelection(); });
            calendar.append(button);
        }
    }

    // Load saved recipes for meal planner
    async function loadSavedRecipesForMeal() {
        const mealRecipeList = tab.querySelector('#meal-recipe-list');
        if (!mealRecipeList) return;
        mealRecipeList.innerHTML = '';

        try {
            const savedRecipes = await getSavedRecipes();
            if (savedRecipes.length === 0) {
                mealRecipeList.innerHTML = '<p style="color:var(--dashboard-text-muted);text-align:center;padding:1rem;">No saved recipes yet. Bookmark recipes from search to add them here.</p>';
                return;
            }
            savedRecipes.forEach(recipe => {
                const card = document.createElement('button');
                card.type = 'button';
                card.className = 'meal-recipe-card';
                card.dataset.recipe = recipe.title || '';
                card.dataset.meta = `${recipe.readyInMinutes ? recipe.readyInMinutes + ' min' : ''}${recipe.calories ? ' • ' + recipe.calories + ' cal' : ''}`;
                card.dataset.image = recipe.image || './placeholder.svg';
                card.dataset.spoonacularId = recipe.spoonacularId || '';
                card.innerHTML = `
                    <img src="${recipe.image || './placeholder.svg'}" alt="${recipe.title || ''}">
                    <span>
                        <strong>${recipe.title || ''}</strong>
                        <small><i class="fas fa-clock"></i> ${recipe.readyInMinutes ? recipe.readyInMinutes + ' min' : 'N/A'}${recipe.calories ? ' • ' + recipe.calories + ' cal' : ''}</small>
                    </span>
                    <i class="fas fa-plus"></i>
                `;
                card.addEventListener('click', async () => {
                    const dateStr = dateKey(selectedDate);
                    const recipeData = {
                        spoonacularId: recipe.spoonacularId,
                        title: recipe.title,
                        image: recipe.image,
                        readyInMinutes: recipe.readyInMinutes,
                        calories: recipe.calories
                    };
                    await saveMealPlan(dateStr, mealType, recipeData);
                    await renderCalendar();
                    await renderSelection();
                });
                mealRecipeList.appendChild(card);
            });
        } catch (error) {
            console.error("Error loading saved recipes for meal planner:", error);
            mealRecipeList.innerHTML = '<p style="color:var(--dashboard-text-muted);text-align:center;padding:1rem;">Failed to load saved recipes.</p>';
        }
    }

    tab.querySelectorAll('#meal-type-options button').forEach(button => button.addEventListener('click', () => {
        mealType = button.dataset.mealType;
        tab.querySelectorAll('#meal-type-options button').forEach(option => option.classList.toggle('active', option === button));
        renderSelection();
    }));

    tab.querySelector('#meal-remove').addEventListener('click', async () => {
        const dateStr = dateKey(selectedDate);
        await removeMealPlan(dateStr, mealType);
        await renderCalendar();
        await renderSelection();
    });

    tab.querySelector('#meal-prev-month').addEventListener('click', async () => { viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1); await renderCalendar(); renderSelection(); });
    tab.querySelector('#meal-next-month').addEventListener('click', async () => { viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1); await renderCalendar(); renderSelection(); });
    tab.querySelector('#meal-today').addEventListener('click', async () => { viewDate = new Date(today.getFullYear(), today.getMonth(), 1); selectedDate = new Date(today); await renderCalendar(); renderSelection(); });

    // View all button navigates to saved recipes tab
    const viewAllBtn = tab.querySelector('.meal-view-all');
    if (viewAllBtn) {
        viewAllBtn.addEventListener('click', () => {
            const savedRecipesLink = document.querySelector('.recipes.page-link');
            if (savedRecipesLink) savedRecipesLink.click();
        });
    }

    // Render when meal tab becomes visible
    const mealLink = document.querySelector('.meal.page-link');
    if (mealLink) {
        mealLink.addEventListener('click', () => {
            setTimeout(async () => {
                if (!_tabSwitched) return;
                await renderCalendar();
                renderSelection();
                loadSavedRecipesForMeal();
            }, 50);
        });
    }

    renderCalendar();
    renderSelection();
    loadSavedRecipesForMeal();
})();

// =============================================================================
// 13. GROCERY LIST TAB
// =============================================================================
/*
 * Multiple grocery lists per user, each with its own subcollection of items.
 * Lists are stored in users/{uid}/groceryLists/{listId} and rendered as
 * clickable cards in the list switcher. Items are stored in the items
 * sub-subcollection and grouped by category for display.
 *
 * Key interactions:
 *   - List switcher: click a list card to load its items.
 *   - Add item: form submission creates a new item document.
 *   - Checkbox: toggles item.purchased (persisted to Firestore).
 *   - Bookmark icon on each item: adds/removes the item name from
 *     users/{uid}.savedFoods array for quick re-add later.
 *   - Saved foods chips: displayed below the form; click to re-add.
 *   - Grocery more button (gear icon): opens a customization modal (inline
 *     HTML, not in dashboard.html) with icon picker + color swatches.
 *     Saves icon/iconColor back to the list document.
 *   - Search: filters items and list cards in real time.
 */

(() => {
const tab = document.querySelector('.grocery-tab');
    if (!tab) return;
    const search = tab.querySelector('#grocery-list-search');
    const form = tab.querySelector('#grocery-add-item');
    const itemInput = tab.querySelector('#grocery-item-input');
    const progress = tab.querySelector('#grocery-progress');
    const currentList = tab.querySelector('#current-grocery-list');
    const listSwitcher = tab.querySelector('.grocery-list-switcher');
    const groceryItemsGroups = tab.querySelector('.grocery-item-groups');
    const savedFoodsContainer = tab.querySelector('.saved-food-chips');
    const groceryMoreBtn = tab.querySelector('.grocery-more-button');

    let activeListId = null;
    let groceryListsCache = [];

    const groceryListCount = tab.querySelector('#grocery-list-count');

    const updateProgress = () => {
        const items = tab.querySelectorAll('.grocery-items li');
        const checked = tab.querySelectorAll('.grocery-items input:checked').length;
        progress.textContent = `${checked} of ${items.length}`;
    };

    const showNoListSelected = () => {
        groceryItemsGroups.innerHTML = '<div class="grocery-empty-state" id="grocery-no-list-selected"><i class="fas fa-cart-shopping"></i><p>No list selected</p><span>Choose a list from the sidebar or create a new one.</span></div>';
        currentList.textContent = 'Select a list';
        progress.textContent = '0 of 0';
        groceryMoreBtn.disabled = true;
        activeListId = null;
    };

    const bindItem = (item, listId, itemId) => {
        const checkbox = item.querySelector('input');
        checkbox.addEventListener('change', async (event) => {
            item.classList.toggle('purchased', event.target.checked);
            updateProgress();
            if (listId && itemId) {
                await toggleGroceryItemPurchased(listId, itemId, event.target.checked);
            }
        });
    };

    const bindList = (listBtn) => {
        listBtn.addEventListener('click', async () => {
            tab.querySelector('.grocery-list-card.active')?.classList.remove('active');
            listBtn.classList.add('active');
            currentList.textContent = listBtn.dataset.list;
            activeListId = listBtn.dataset.listId || null;
            groceryMoreBtn.disabled = false;
            if (activeListId) {
                await loadGroceryItems(activeListId);
            }
        });
    };

    async function loadGroceryItems(listId) {
        groceryItemsGroups.innerHTML = '';
        try {
            const items = await getGroceryItems(listId);
            if (items.length === 0) {
                groceryItemsGroups.innerHTML = '<div class="grocery-empty-state"><i class="fas fa-cart-shopping"></i><p>No items in this list yet.</p><span>Add items above to get started.</span></div>';
                updateProgress();
                return;
            }

            const categories = {};
            items.forEach(item => {
                const cat = item.category || 'Other';
                if (!categories[cat]) categories[cat] = [];
                categories[cat].push(item);
            });

            Object.entries(categories).forEach(([catName, catItems]) => {
                const group = fromHTML(`
                    <div class="grocery-item-group">
                        <h3>${catName} <span>${catItems.length} items</span></h3>
                        <ul class="grocery-items"></ul>
                    </div>
                `);
                const ul = group.querySelector('ul');
                catItems.forEach(item => {
                    const li = document.createElement('li');
                    if (item.purchased) li.classList.add('purchased');
                    li.dataset.name = item.name;
                    li.innerHTML = `
                        <label>
                            <input type="checkbox" ${item.purchased ? 'checked' : ''}>
                            <span class="grocery-checkmark"></span>
                            <span>${item.name} <small>${item.quantity || '1'}</small></span>
                        </label>
                        <button type="button" class="save-food" aria-label="Save ${item.name}"><i class="${item.saved ? 'fas' : 'far'} fa-bookmark"></i></button>
                    `;
                    bindItem(li, listId, item.id);

                    const saveBtn = li.querySelector('.save-food');
                    saveBtn.addEventListener('click', async () => {
                        const icon = saveBtn.querySelector('i');
                        if (icon.classList.contains('far')) {
                            await addSavedFood(item.name);
                            icon.classList.remove('far');
                            icon.classList.add('fas');
                            renderSavedFoods();
                        } else {
                            await removeSavedFood(item.name);
                            icon.classList.remove('fas');
                            icon.classList.add('far');
                            renderSavedFoods();
                        }
                    });

                    ul.appendChild(li);
                });
                groceryItemsGroups.appendChild(group);
            });
            updateProgress();
        } catch (error) {
            console.error("Error loading grocery items:", error);
        }
    }

    async function loadGroceryLists() {
        groceryListsCache = await getGroceryLists();
        listSwitcher.innerHTML = '';
        groceryListCount.textContent = `${groceryListsCache.length} list${groceryListsCache.length !== 1 ? 's' : ''}`;

        if (groceryListsCache.length === 0) {
            listSwitcher.innerHTML = '<p class="grocery-empty-lists">No lists yet. Create one to get started.</p>';
            showNoListSelected();
            return;
        }

        const timeAgo = (ts) => {
            if (!ts) return '';
            const ms = Date.now() - (ts.seconds ? ts.seconds * 1000 : ts);
            const mins = Math.floor(ms / 60000);
            if (mins < 1) return 'Just now';
            if (mins < 60) return `${mins} min. ago`;
            const hrs = Math.floor(mins / 60);
            if (hrs < 24) return `${hrs} hr. ago`;
            const days = Math.floor(hrs / 24);
            if (days === 1) return 'Yesterday';
            if (days < 30) return `${days} days ago`;
            return `${Math.floor(days / 30)} mo. ago`;
        };

        groceryListsCache.forEach((list, idx) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'grocery-list-card' + (idx === 0 ? ' active' : '');
            btn.dataset.list = list.name;
            btn.dataset.listId = list.id;

            const iconClass = list.icon || 'fa-basket-shopping';
            const iconColorClass = list.iconColor || '';

            btn.innerHTML = `
                <span class="grocery-list-icon ${iconColorClass}"><i class="fas ${iconClass}"></i></span>
                <span><strong>${list.name}</strong><small class="grocery-list-meta">Loading...</small></span>
                <i class="fas fa-chevron-right"></i>
            `;
            bindList(btn);
            listSwitcher.appendChild(btn);
        });

        // Fetch item counts + updatedAt for all lists in parallel
        const metaPromises = groceryListsCache.map(async (list) => {
            let count = 0, updatedAt = null;
            try {
                const snap = await getDocs(collection(db, "users", uid(), "groceryLists", list.id, "items"));
                count = snap.size;
                updatedAt = list.updatedAt;
            } catch (_) {}
            return { listId: list.id, count, updatedAt };
        });
        const metas = await Promise.all(metaPromises);
        listSwitcher.querySelectorAll('.grocery-list-card').forEach(btn => {
            const meta = metas.find(m => m.listId === btn.dataset.listId);
            if (!meta) return;
            const small = btn.querySelector('.grocery-list-meta');
            if (small) {
                const ago = timeAgo(meta.updatedAt);
                small.textContent = ago ? `${meta.count} items • ${ago}` : `${meta.count} items`;
            }
        });

        // Load first list items
        if (groceryListsCache.length > 0) {
            activeListId = groceryListsCache[0].id;
            currentList.textContent = groceryListsCache[0].name;
            groceryMoreBtn.disabled = false;
            await loadGroceryItems(activeListId);
        }
    }

    async function renderSavedFoods() {
        if (!savedFoodsContainer) return;
        savedFoodsContainer.innerHTML = '';
        try {
            const foods = await loadSavedFoods();
            foods.forEach(food => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.dataset.food = food;
                btn.textContent = food;
                btn.addEventListener('click', async () => {
                    if (!activeListId) { alert('Please select a list first.'); return; }
                    await addGroceryItem(activeListId, food, '1', 'Other');
                    await loadGroceryItems(activeListId);
                });
                savedFoodsContainer.appendChild(btn);
            });
        } catch (error) {
            console.error("Error rendering saved foods:", error);
        }
    }

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const name = itemInput.value.trim();
        if (!name || !activeListId) return;
        await addGroceryItem(activeListId, name, '1', 'Other');
        itemInput.value = '';
        await loadGroceryItems(activeListId);
    });

    search.addEventListener('input', () => {
        const query = search.value.trim().toLowerCase();
        tab.querySelectorAll('.grocery-items li').forEach(item => { item.hidden = !item.dataset.name.toLowerCase().includes(query); });
        tab.querySelectorAll('.grocery-list-card').forEach(list => { list.hidden = !!query && !list.dataset.list.toLowerCase().includes(query); });
        tab.querySelectorAll('.grocery-item-group').forEach(group => { group.hidden = !!query && !group.querySelector('li:not([hidden])'); });
    });

    // ── Modal helpers ──────────────────────────────────────────────────────
    const modalOverlay = document.getElementById('grocery-modal-overlay');
    const modalTitle = document.getElementById('grocery-modal-title');
    const modalNameField = document.getElementById('grocery-modal-name-field');
    const modalNameInput = document.getElementById('grocery-modal-name-input');
    const modalIconField = document.getElementById('grocery-modal-icon-field');
    const modalIconPicker = document.getElementById('grocery-modal-icon-picker');
    const modalColorField = document.getElementById('grocery-modal-color-field');
    const modalColorPicker = document.getElementById('grocery-modal-color-picker');
    const modalDeleteBtn = document.getElementById('grocery-modal-delete-btn');
    const modalCancel = document.getElementById('grocery-modal-cancel');
    const modalSave = document.getElementById('grocery-modal-save');

    const LIST_ICONS = ['fa-basket-shopping', 'fa-pepper-hot', 'fa-carrot', 'fa-apple-whole', 'fa-fish', 'fa-egg', 'fa-bread-slice', 'fa-cheese', 'fa-drumstick-bite', 'fa-pizza-slice', 'fa-bowl-food', 'fa-ice-cream', 'fa-cake-candles', 'fa-beer-mug-empty', 'fa-wine-glass', 'fa-mug-hot', 'fa-utensils', 'fa-bowl-food', 'fa-cart-shopping', 'fa-seedling', 'fa-leaf', 'fa-fire', 'fa-heart', 'fa-star', 'fa-clock', 'fa-calendar', 'fa-house'];
    const LIST_COLORS = [
        { name: 'Green', cls: 'green', hex: '#ccefc0' },
        { name: 'Warm', cls: 'warm', hex: '#f8d49e' },
        { name: 'Blue', cls: 'blue', hex: '#bfe6e7' },
        { name: 'Rose', cls: 'rose', hex: '#f8c4c4' },
        { name: 'Lavender', cls: 'lavender', hex: '#d4c4f8' },
        { name: 'Mint', cls: 'mint', hex: '#c4f8e0' },
        { name: 'Peach', cls: 'peach', hex: '#f8dcc4' },
        { name: 'Sky', cls: 'sky', hex: '#c4e0f8' }
    ];

    function openModal(config) {
        modalTitle.textContent = config.title || '';
        modalNameField.hidden = !config.showName;
        if (config.showName) {
            modalNameInput.value = config.nameValue || '';
            modalNameInput.placeholder = config.namePlaceholder || '';
        }
        modalIconField.hidden = !config.showIconPicker;
        modalColorField.hidden = !config.showColorPicker;
        modalDeleteBtn.hidden = !config.showDelete;

        if (config.showIconPicker) {
            modalIconPicker.innerHTML = LIST_ICONS.map(icon => `
                <button type="button" class="icon-option${icon === (config.selectedIcon || 'fa-basket-shopping') ? ' is-selected' : ''}" data-icon="${icon}"><i class="fas ${icon}"></i></button>
            `).join('');
        }
        if (config.showColorPicker) {
            modalColorPicker.innerHTML = LIST_COLORS.map(c => `
                <button type="button" class="color-option${c.cls === (config.selectedColor || '') ? ' is-selected' : ''}" data-cls="${c.cls}" style="background:${c.hex}" title="${c.name}"></button>
            `).join('');
        }

        let selectedIcon = config.selectedIcon || 'fa-basket-shopping';
        let selectedColor = config.selectedColor || LIST_COLORS[0].cls;

        modalSave.textContent = config.saveText || 'Save';

        const iconPicker = modalIconPicker;
        const colorPicker = modalColorPicker;

        iconPicker.querySelectorAll('.icon-option').forEach(btn => {
            btn.addEventListener('click', () => {
                iconPicker.querySelectorAll('.icon-option').forEach(b => b.classList.remove('is-selected'));
                btn.classList.add('is-selected');
                selectedIcon = btn.dataset.icon;
            });
        });

        colorPicker.querySelectorAll('.color-option').forEach(btn => {
            btn.addEventListener('click', () => {
                colorPicker.querySelectorAll('.color-option').forEach(b => b.classList.remove('is-selected'));
                btn.classList.add('is-selected');
                selectedColor = btn.dataset.cls;
            });
        });

        modalOverlay.hidden = false;
        if (config.showName) modalNameInput.focus();

        let resolved = false;
        const close = () => { if (!resolved) { modalOverlay.hidden = true; resolved = true; } };

        modalCancel.onclick = close;
        modalOverlay.onclick = (e) => { if (e.target === modalOverlay) close(); };

        if (config.showName) {
            modalNameInput.onkeydown = (e) => {
                if (e.key === 'Enter') modalSave.click();
                if (e.key === 'Escape') close();
            };
        }

        return new Promise((resolve) => {
            modalSave.onclick = async () => {
                const name = config.showName ? modalNameInput.value.trim() : null;
                if (config.showName && !name) {
                    modalNameInput.focus();
                    return;
                }
                close();
                resolve({ name, icon: selectedIcon, color: selectedColor });
            };
            if (config.showDelete) {
                modalDeleteBtn.onclick = async () => {
                    if (confirm(config.deleteConfirm || 'Delete this list? This cannot be undone.')) {
                        close();
                        resolve({ delete: true });
                    }
                };
            }
        });
    }

    // ── New grocery list ────────────────────────────────
    tab.querySelector('#new-grocery-list').addEventListener('click', async () => {
        const result = await openModal({
            title: 'New grocery list',
            showName: true,
            namePlaceholder: 'e.g. Weekly shop',
            showIconPicker: true,
            showColorPicker: true,
            selectedIcon: 'fa-basket-shopping',
            selectedColor: LIST_COLORS[0].cls,
            showDelete: false,
            saveText: 'Create list'
        });
        if (result) {
            const id = await createGroceryList(result.name, result.icon, result.color);
            if (id) {
                await loadGroceryLists();
                renderSavedFoods();
            }
        }
    });

    // ── Save food ───────────────────────────────────────
    const savedFoodsAddBtn = tab.querySelector('.grocery-saved-foods .grocery-panel-heading button');
    if (savedFoodsAddBtn) {
        savedFoodsAddBtn.addEventListener('click', async () => {
            const result = await openModal({
                title: 'Save a food',
                showName: true,
                namePlaceholder: 'e.g. Avocados',
                showIconPicker: false,
                showColorPicker: false,
                showDelete: false,
                saveText: 'Save'
            });
            if (result && result.name) {
                await addSavedFood(result.name);
                renderSavedFoods();
            }
        });
    }

    // ── Customize list ──────────────────────────────────
    if (groceryMoreBtn) {
        groceryMoreBtn.addEventListener('click', async () => {
            if (!activeListId) return;
            const list = groceryListsCache.find(l => l.id === activeListId);
            if (!list) return;

            const result = await openModal({
                title: `Customize "${list.name}"`,
                showName: true,
                nameValue: list.name,
                showIconPicker: true,
                showColorPicker: true,
                selectedIcon: list.icon || 'fa-basket-shopping',
                selectedColor: list.iconColor || LIST_COLORS[0].cls,
                showDelete: true,
                deleteConfirm: `Delete "${list.name}" and all its items? This cannot be undone.`,
                saveText: 'Save'
            });
            if (result) {
                if (result.delete) {
                    await deleteGroceryList(activeListId);
                    showNoListSelected();
                    await loadGroceryLists();
                    await renderSavedFoods();
                } else {
                    await updateGroceryList(activeListId, {
                        name: result.name || list.name,
                        icon: result.icon,
                        iconColor: result.color
                    });
                    await loadGroceryLists();
                }
            }
        });
    }
    // Load on grocery tab visibility
    const groceryLink = document.querySelector('.grocery.page-link');
    if (groceryLink) {
        groceryLink.addEventListener('click', () => {
            setTimeout(async () => {
                if (!_tabSwitched) return;
                await loadGroceryLists();
                await renderSavedFoods();
            }, 50);
        });
    }

    loadGroceryLists();
    renderSavedFoods();
})();
