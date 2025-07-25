// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyD0sT-1xGupgwRSZbuTbxfz31fKdoJxIec",
  authDomain: "ingredient-insight.firebaseapp.com",
  projectId: "ingredient-insight",
  storageBucket: "ingredient-insight.appspot.com",
  messagingSenderId: "902913834209",
  appId: "1:902913834209:web:812580001520c60b630ba0",
  measurementId: "G-BC0TF1RNX6"
};

// Initialize Firebase
export const app = initializeApp(firebaseConfig);
export const analytics = getAnalytics(app);
export const ak = "Lq7Lsq4q94qx1L7sqbqL74";
