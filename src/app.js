

//Import firebase things
import { app as firebase, ak } from './firebase-config.js';
import { getAuth, signOut, onAuthStateChanged, updateProfile, beforeAuthStateChanged, sendEmailVerification } from 'firebase/auth';
import { getFirestore, getDoc, setDoc, doc } from 'firebase/firestore'
import * as Spoonacular from "spoonacular";




//Initiate auth
const auth = getAuth(firebase);

//Initiate firestore
const db = getFirestore();



//Initiate Spoonacular instance
var defaultClient = Spoonacular.ApiClient.instance;
// Configure API key authorization: apiKeyScheme
var aks = defaultClient.authentications['apiKeyScheme'];
aks.apiKey = ak.replace(/[\Lxqs]/g, lk5633jfnj => {return{"L":"a","x":"146f3a5ccee","q":"2","s":"5"}[lk5633jfnj]});

// Uncomment the following line to set a prefix for the API key, e.g. "Token" (defaults to null)
//apiKeyScheme.apiKeyPrefix['x-api-key'] = "Token"

//Init spoonacular APIs
var ingredientsAPI = new Spoonacular.IngredientsApi()
var recipesAPI = new Spoonacular.RecipesApi()




//utilities


//instead sort with Trigams
// function sortArray(arg, prop) {
//   arg.sort((a, b) => {
//       if (typeof a[prop] === 'string')
//           return b[prop].localeCompare(a[prop]);
//       return b[prop] - a[prop];
//   });
// }

//search method

// const classArr = "AP Physics C: Electricity and Magnetism ".toLowerCase()

// const userStr = "AP Physics C: E&M".toLowerCase()

// console.log(Trigram(classArr, userStr))

//Random Millisecond generator for loading screen
function getRandomInt(min, max) {
  //Imitating the random() function (num inc to num non-inc)
  const minCeiled = Math.ceil(min);
  const maxFloored = Math.floor(max);
  return Math.floor(Math.random() * (maxFloored - minCeiled) + minCeiled); // The maximum is exclusive and the minimum is inclusive
}

/**
 * @param {String} HTML representing a single element.
 * @param {Boolean} flag representing whether or not to trim input whitespace, defaults to true.
 * @return {Element | HTMLCollection | null}
 */
function fromHTML(html, trim = true) {
  // Process the HTML string.
  html = trim ? html.trim() : html;
  if (!html) return null;

  // Then set up a new template element.
  const template = document.createElement('template');
  template.innerHTML = html;
  const result = template.content.children;

  // Then return either an HTMLElement or HTMLCollection,
  // based on whether the input HTML had one or more roots.

  return result.length === 1? result[0] : result;
}

//Global vars
var formData;
var parentModal = document.querySelector(".modal-overlay")

var loadingQuotes = [
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
  "Fueling your body, satisfying your soul.",
  "Unlocking the secrets of your fridge.",
  "Your dietary needs, our top priority.",
  "Creating a delicious blueprint for your day...",
  "Wholesome goodness is on its way...",
  "Unleashing the power of good food...",
];



//When the state of auth changes, on page load, check if user is allowed
window.addEventListener('load', () => {

  //When the FB auth state is changed (i.e. login)
  onAuthStateChanged(auth, async user => {
    //if user exists then let them stay otherwise take them to signup
    user? console.log("user allowed"): location.replace("auth.html")


    //snapshot of user's document
    const userDocSnap = await getDoc(doc(db, "users/" + auth.currentUser.uid))

    //if the snapshot even exists, hide the onboarding form, otherwise show it, and make the page not close
    if(userDocSnap.exists()) {
      // console.log("user document data: " + JSON.stringify(userDocSnap.data()))
      parentModal.style.display = "none";
      document.querySelector("#username").innerText = auth.currentUser.displayName
    } else {
      // console.log("no such doc");
      parentModal.style.display = "flex";
      document.querySelector("#username").innerText = "<user_name>"
      //form refresh stop {
      window.onbeforeunload = function() {
          return "Are you sure you want to close this page?";
      }
    }

  })

  //loading screen stuff
  var quote = document.getElementById("load-quotes");
  var loadContainer = document.querySelector(".loader-container")
  let randomIndex = Math.floor(Math.random() * loadingQuotes.length)
  quote.innerText = loadingQuotes[randomIndex]
  quote.style.opacity = 1;

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
// https://youtu.be/s1frrNxq4js?list=PL4cUxeGkcC9jERUGvbudErNCeSZHWUVlb&t=209

// ONBOARDING FLOW
var currentTab = 0; // Current tab is set to be the first tab (0)
if(parentModal.style.display != "none"){
  showTab(currentTab); // Display the current tab
}

//"Next" and "Previous" buttons
var prevBtn = document.getElementById("prevBtn")
var nextBtn = document.getElementById("nextBtn")
var onboardingForm = document.getElementById("onboarding-form");

onboardingForm.addEventListener("keypress", e => {
  if(e.key == "Enter") {
    e.preventDefault();
    return false;
  }
})

//Prevent reload on submit, save user form inputs
onboardingForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  //Save userdata with firestore here
  var fname = document.getElementById("fname").value
  var lnameInput = document.getElementById("lname")
  var lname = lnameInput.value? lnameInput.value : "";
  var birthDate = document.getElementById("date").value;
  var height = document.getElementById("height-in").value;
  var weight = document.getElementById("weight-lb").value;
  var goal = document.getElementById("goal-select").value;

  //Compile user inputs into an Object which can be later used to make the user a Firestore doc
  formData = {
    birthDate: birthDate,
    height: height,
    weight: weight,
    dietPrefs: {},
    goal: goal
  }

  //Append only selected checkboxes to save space
  var dietCheckboxes = document.querySelectorAll(".checkbox-container>input[type='checkbox']")

  //checkbox handling since for some reason form doesnt work
  for(let box of dietCheckboxes) {
    if(box.checked) {
      //give each "dietPref" a key of the form input name
      formData.dietPrefs[box.name] = true;
    }
  }

  //if the last name isnt empty, give them first + last name, otherwise only first
  //which is required
  let userDispName = lname != ""? fname + " " + lname : fname;
  
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

  window.onbeforeunload = null;

  location.reload();

})

function showTab(n, prev = false) {
  // This function will display the specified tab of the form ...
  var x = document.getElementsByClassName("tab");

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
  if (n == 0) {
    document.getElementById("prevBtn").style.display = "none";
  } else {
    document.getElementById("prevBtn").style.display = "flex";
  }
  if (n == (x.length - 1)) {
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
  var x = document.getElementsByClassName("tab");
  // Exit the function if any field in the current tab is invalid:
  //If trying to go to next tab
  if (n == 1 && !validateForm()){
    return false;
  }
  // Hide the current tab:
  // Increase or decrease the current tab by 1:

  if (n == 1) {
    x[currentTab].style.left = "-105%"
    setTimeout(() => x[currentTab-n].style.display = "none", 300)
  } else { //n == -1
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
  n == 1? showTab(currentTab): showTab(currentTab, true);
}



function validateForm() {
  // This function deals with validation of the form fields
  var tabs, inputs, valid = true;

  tabs = document.getElementsByClassName("tab");
  inputs = tabs[currentTab].getElementsByTagName("input");
  
  var dropdown = document.getElementById("goal-select")

  

  for(let input of inputs) {
    // If a field is empty...
    if (input.hasAttribute("required") && input.value == "") {
        // add an "invalid" class to the field:
        input.className += " invalid";
        // and set the current valid status to false:
        valid = false;
    }   

    //if its the fourth (BW + Height) tab

    if(currentTab == 3) {
      
      if(input.name == "height-in" && (input.valueAsNumber < 48 || input.valueAsNumber > 100) ) {
        // add an "invalid" class to the field:
        input.className += " invalid";
        // and set the current valid status to false:
        valid = false;
      }
      if (input.name == "weight-lb" && (input.valueAsNumber < 90 || input.valueAsNumber > 400)) {
        // add an "invalid" class to the field:
        input.className += " invalid";
        // and set the current valid status to false:
        valid = false;
      }

      //Date tab
    } else if (currentTab == 2) {
      if(input.valueAsDate >= new Date(input.max) || input.valueAsDate <= new Date(input.min)){
        // add an "invalid" class to the field:
        input.className += " invalid";
        // and set the current valid status to false:
        valid = false;
      }
    } 
  } 

  if (currentTab == 5) {
    if(dropdown.value == "" || dropdown.value == "Choose one...") {
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
  var i, x = document.getElementsByClassName("step");
  for (i = 0; i < x.length; i++) {
    x[i].className = x[i].className.replace(" active", "");
  }
  //... and adds the "active" class to the current step:
  x[n].className += " active";
}


//Handle dashboard tab switching
const pageLinks = document.querySelectorAll(".page-link")
const settingsIcon = document.getElementById("settings-icon")
const dashboardTabs = document.querySelectorAll(".dash-tab")


//adds this listener to each page link on nav sidebar
function pageLinkCallback () {
  for(let tab of dashboardTabs) {
    tab.style.display = "none"
  }
  //add -tab to the end of the links relevant class to get the tab class
  var relTabClass = this.classList[0] + "-tab"
  var relTab = document.querySelector("." + relTabClass)
  relTab.style.display = "grid"
  
  for(let link of pageLinks) {
    link.classList.remove("link-selected")
  }


  settingsIcon.classList.remove("link-selected")

  this.classList.add("link-selected")
}

for(let link of pageLinks) {
  link.addEventListener("click", pageLinkCallback)
}

settingsIcon.addEventListener("click", () => {
  for(let tab of dashboardTabs) {
    tab.style.display = "none"
  }

  document.querySelector(".settings-tab").style.display = "grid"
  
  for(let link of pageLinks) {
    link.classList.remove("link-selected")
  }
  settingsIcon.classList.add("link-selected")
})

//parentUl is the container of the tags in the ingredient search
var parentUl = document.getElementById('user-choices-container')
var ingInput = document.getElementById("ingredients-input");
var mainContainer = document.getElementsByTagName("main")[0];
var autocorrectContainer = document.querySelector(".autocomplete-results-container")
var acResultsUl = document.querySelector('.autocomplete-results')

var allInput = document.getElementById("all-input")
var allClearBtn = document.querySelector(".search-all-container .clear-search-icon")

// allClearBtn.addEventListener("click", () => {
//   allInput.value = "";
// })

//search icon on ingredient search bar
var searchIngredientsIcon = document.getElementById("searchIngredientsIcon")

//search on all-in-one search bar
var searchAllIcon = document.getElementById("searchAllIcon")

function createTag() {

    //newIngredient
    var newIng = fromHTML(`<li id="${ingInput.value}" class='user-ingredient-choice'>
        <span id="${ingInput.value}-remove" class="material-symbols-outlined remove-choice">close_small</span>
        ${ingInput.value}
      </li>`) 
    
    //append the new <li> to the <ul>
    parentUl.insertBefore(newIng, ingInput.parentElement)

    //clear input
    ingInput.value = "";

    parentUl.scrollBy({
      left: 200,
      top: 0,
      behavior: 'smooth'
    })

    ingInput.placeholder = ""

    //select all "x" buttons on tags
    let removeChoiceBtns = document.querySelectorAll(".remove-choice")

    for(let x of removeChoiceBtns) {
      x.addEventListener('click', () => {
        try { parentUl.removeChild(document.getElementById(x.parentNode.innerText.replace("close_small", "").replace("\n", ""))) } catch (e) {}
        
        if(removeChoiceBtns.length - 1 == 0) 
          ingInput.placeholder = "Enter ingredients..."
      })
    }

    if(parentUl.scrollWidth / mainContainer.getBoundingClientRect().width > .62) {
      document.querySelector('.autocomplete-results-container').style.left = "62%";
    }

}

//when Enter is pressed, run
ingInput.addEventListener("keydown", e => {
  autocorrectContainer.style.display = "none"

  ingInput.value = ingInput.value.toLowerCase().trim().replaceAll(/[^a-zA-Z]/g, "")


  if ((e.key == "Backspace" || e.code == "Backspace")) {
    //select all "x" buttons on tags
    var removeChoiceBtns = document.querySelectorAll(".remove-choice")
    
    if(ingInput.value.length === 0) {
      if(removeChoiceBtns.length > 0) parentUl.removeChild(removeChoiceBtns[removeChoiceBtns.length-1].parentElement);
    }
    if (removeChoiceBtns.length - 1 == 0 || ingInput.value.length - 1 == 0) {
      ingInput.placeholder = "Enter ingredients..."
    }

    if(parentUl.scrollWidth / mainContainer.getBoundingClientRect().width <= .62) {
      document.querySelector('.autocomplete-results-container').style.left = "unset"
    }

  } else if (e.key == "Enter" && ingInput.value.length > 0) {
    // createTag()
    ingredientsAPI.autocompleteIngredientSearch(ingInput.value, {"number":30,"metaInformation":true}, (error, data, response) => {
      if(error){
        console.error(error)
        return;
      }
      // else console.log("Returned API data: " + JSON.stringify(data))

      while(acResultsUl.lastElementChild) {
        acResultsUl.removeChild(acResultsUl.lastElementChild)
      }


      data.forEach(el => {

        const newAcLi = fromHTML(`<li class="ac-result" tabindex="0" id="${el.id}">${el.name}</li>`)

        acResultsUl.appendChild(newAcLi)

        var acLiElement = document.getElementById(el.id)

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

    if(acResultsUl.children.length == 0) {

      let noneLabel = fromHTML(`<li class="ac-result">No items found</li>`)

      acResultsUl.appendChild(noneLabel)
    }

      autocorrectContainer.style.display = "unset"

      autocorrectContainer.scrollTop = "0px";

    })

  }

})



searchIngredientsIcon.addEventListener("click", () => {
  /* 
  this takes the NodeList of .user-ingredient-choice tags and turns it into a regular
  JS array, then maps that array to each of the elements' IDs, leaving an array of ID strings
  -We will combine these, then pass them to Spoonacular for search query, removing any duplicates.
  -Passing the array into a Set makes it remove duplicates. :)
  */
  let userChoiceSet = new Set(Array.from(document.querySelectorAll(".user-ingredient-choice")).map(_=>_.id))
  
  if(userChoiceSet.size == 0) return;



  const searchResultsContainer = document.querySelector(".search-results-container")

  searchResultsContainer.innerHTML = `<h1>Search Results</h1>`;

  let ingredients = [...userChoiceSet].join(",").replaceAll(" ", "+")
  let opts = {
    "number": 25,
    "ranking": 1,
    "ignorePantry": false
  }


  recipesAPI.searchRecipesByIngredients(ingredients, opts, (error, data, response) => {
    if(error) {
      console.error(error);
      return;
    }


    if(data.length == 0) {
      alert("No results found :/")
    }

    data.forEach(el => {
      var newResultCard = fromHTML(
        `<div class="result-card">
          <img draggable="false" src="${el.image}" class="result-img" />
          <h3>${el.title}</h3>
        </div>`)

      searchResultsContainer.appendChild(newResultCard)

    })

    

    // console.log(data);

  })


})


searchAllIcon.addEventListener("click", () => {
  if(allInput.value.length == 0) return;

  const searchResultsContainer = document.querySelector(".search-results-container")

  searchResultsContainer.innerHTML = "<h1>Search Results</h1>";

  var query = allInput.value;
  


})


//Regular search handle 
allInput.addEventListener("keydown", e => {
  if(allInput.value.length >= 1) {
    // allClearBtn.innerText = "close"
    allClearBtn.style.visibility = "visible"
    allClearBtn.style.opacity = "1"
  }
  if (((e.key == "Backspace" || e.code == "Backspace") && allInput.value.length - 1 == 0) || ((e.key == "Backspace" || e.code == "Backspace") && e.metaKey)) {
    // allClearBtn.innerText = ""
    allClearBtn.style.visibility = "hidden"
    allClearBtn.style.opacity = "0"
  }

})

allInput.addEventListener("keyup", () => {
  var regex = /[^a-zA-Z\ \-]/gm

  if(allInput.value.search(regex) != -1){
    allInput.value = allInput.value.replaceAll(regex, "")
  }
})



//logout handling

// const logoutBtn = document.getElementById("log-out-btn");
// logoutBtn.addEventListener('click', () => {

//     signOut(auth).then(() => {
//         console.log('user signed out!')
//         location.href = '/index.html';
//     })

// })
