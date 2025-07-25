import { app as firebase } from './firebase-config.js';
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, GoogleAuthProvider, signInWithPopup, onAuthStateChanged } from 'firebase/auth';


const auth = getAuth(firebase);
const provider = new GoogleAuthProvider();


//DOM els
const joinWithGoogleBtn = document.getElementById('join-with-google-btn');
const loginWithGoogleBtn = document.getElementById('login-with-google-btn');

const joinForm = document.getElementById('join-form');
const loginForm = document.getElementById('login-form');

const loginLink = document.getElementById('switch-to-login-link');
const joinLink = document.getElementById('switch-to-join-link');


if (localStorage.getItem("login") === "true") {
    loginForm.style.display = 'flex';
    joinForm.style.display = 'none';
} else {
    loginForm.style.display = 'none';
    joinForm.style.display = 'flex';
}

loginLink.addEventListener('click', () => {

    loginForm.style.display = 'flex';
    joinForm.style.display = 'none';

})

joinLink.addEventListener('click', () => {

    loginForm.style.display = 'none';
    joinForm.style.display = 'flex';
    

})

joinForm.addEventListener('submit', (e) => {

    e.preventDefault();

    const email = joinForm.email.value;
    const password = joinForm.password.value;

    createUserWithEmailAndPassword(auth, email, password)
        .then((cred) => {
            console.log('user created', cred.user)
            joinForm.reset()
            location.replace("/dashboard")
        })
        .catch((err) => {
            console.log(err.message)
        })

})

loginForm.addEventListener('submit', (e) => {

    e.preventDefault();

    // const username = loginForm.username.value;
    const email = loginForm.email.value;
    const password = loginForm.password.value;

    signInWithEmailAndPassword(auth, email, password)
        .then((cred) => {
            console.log('user signed in', cred.user)
            loginForm.reset()
            location.replace("/dashboard")
        })
        .catch((err) => {
            console.log(err.message)
        })

})


joinWithGoogleBtn.addEventListener('click', () => {

    signInWithPopup(auth, provider)
        .then((result) => {
            console.log('user joined with google!')
            location.replace("/dashboard")
        })
        .catch((err) => {
            console.log(err.message)
        })

})

loginWithGoogleBtn.addEventListener('click', () => {

    signInWithPopup(auth, provider)
        .then((result) => {
            console.log('user logged in with google!')
            location.replace("/dashboard")
        })
        .catch((err) => {
            console.log(err.message)
        })

})

onAuthStateChanged(auth, user => {

    if (user) {
        console.log('user is currently signed in!')
    } else {
        console.log('user is currently signed out!')
    }

    // console.log(user);



})